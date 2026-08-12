// ============================================================
// AXIOM AI OS — Milestone 13: Trigger Scheduler
// ------------------------------------------------------------
// Objective 4: "Enable scheduled and triggered tasks."
//
// Two distinct firing mechanisms, one uniform registry:
//   - SCHEDULED: fires on a timer — a fixed interval ("every") or a
//     specific future time ("at").
//   - TRIGGERED: fires the moment a named event crosses the shared
//     Agent Event Bus (Milestone 4) — e.g. "whenever agent.browser
//     completes a task, run workflow.X". No polling, no side channel.
//
// This module never decides WHAT runs beyond looking up a workflow
// (AxiomWorkflowEngine.run) or a skill (AxiomSkillRegistry.invoke) by
// id and handing off — it owns only WHEN. Every firing goes through
// AxiomCapabilityKit.withCapability() (Milestone 5) for uniform
// retry/timeout/lifecycle events, exactly like every other unit of
// work in this runtime (Objective 7 — reliability, via reuse rather
// than new retry code). Definitions persist the same bounded,
// best-effort localStorage way job-manager.js already does, so
// schedules survive a page refresh (timers themselves are re-armed on
// load, matching the "in-memory index over a persisted record"
// pattern job-manager.js's `live` map already establishes).
//
// Public surface — window.AxiomTriggerScheduler:
//   .schedule(spec)   -> { ok, id?, error? }
//     spec = { id?, name?, workflowId? | skillId?, input?,
//               type: 'interval' | 'at' | 'event',
//               intervalMs?,           // type: 'interval'
//               at?,                   // type: 'at'      (epoch ms)
//               eventType?,            // type: 'event'
//               priority?, retries?, enabled? }
//   .cancel(id)        -> boolean
//   .pause(id) / .resume(id) -> boolean
//   .list()            -> trigger snapshot[]
//   .getTrigger(id)    -> trigger snapshot | null
// ============================================================
window.AxiomTriggerScheduler = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var KIT = window.AxiomCapabilityKit;
  if (!RT || !KIT) {
    AxLogger.error('[AxiomTriggerScheduler] requires agent-runtime.js and capability-kit.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var STORAGE_KEY = 'axiom-triggers';
  var uid = window.AxiomMakeSeqId('trg'); // see os/shared/id-factory.js
  var live = new Map(); // id -> { timer?, offEvent?, fireCount, lastFiredAt, lastResult, enabled, def }

  function emit(type, id, payload) { bus.emit(type, 'trigger-scheduler', Object.assign({ id: id }, payload || {})); }

  function loadDefs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveDefs(defs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(defs)); }
    catch (e) { AxLogger.warn('[AxiomTriggerScheduler] could not persist trigger definitions:', e); }
  }
  function persistOne(id) {
    var l = live.get(id);
    if (!l) return;
    var defs = loadDefs();
    defs[id] = l.def;
    saveDefs(defs);
  }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Trigger spec must be an object.';
    if (!spec.workflowId && !spec.skillId) return 'Trigger spec requires a "workflowId" or "skillId" to run.';
    if (['interval', 'at', 'event'].indexOf(spec.type) === -1) return 'Trigger spec requires type "interval", "at", or "event".';
    if (spec.type === 'interval' && !(typeof spec.intervalMs === 'number' && spec.intervalMs > 0)) return 'type "interval" requires a positive "intervalMs".';
    if (spec.type === 'at' && !(typeof spec.at === 'number' && spec.at > 0)) return 'type "at" requires a numeric epoch-ms "at".';
    if (spec.type === 'event' && !spec.eventType) return 'type "event" requires an "eventType" to listen for.';
    return null;
  }

  // The ONE execution path every firing takes, whether from a timer or an
  // event — wrapped in the existing capability kit so a flaky downstream
  // workflow/skill gets bounded retries and a timeout without this module
  // re-implementing either.
  function fire(id) {
    var l = live.get(id);
    if (!l || !l.enabled) return;
    var def = l.def;
    l.fireCount += 1;
    l.lastFiredAt = Date.now();
    emit('trigger:fired', id, { fireCount: l.fireCount, workflowId: def.workflowId || null, skillId: def.skillId || null });

    var task = { id: id + ':' + l.fireCount, cancelled: false };
    var ctx = { bus: bus, agent: { id: 'trigger:' + id }, manager: window.AxiomAgentManager };

    var fn = function () {
      if (def.workflowId) {
        var WF = window.AxiomWorkflowEngine;
        if (!WF) return Promise.reject(new Error('AxiomWorkflowEngine unavailable.'));
        return WF.run(def.workflowId, def.input).promise;
      }
      var SK = window.AxiomSkillRegistry;
      if (!SK) return Promise.reject(new Error('AxiomSkillRegistry unavailable.'));
      return SK.invoke(def.skillId, def.input);
    };

    KIT.withCapability('trigger:' + id, task, ctx, fn, { retries: def.retries || 1, timeoutMs: 30000 })
      .then(function (result) {
        l.lastResult = { ok: true, at: Date.now() };
        persistOne(id);
        emit('trigger:completed', id, { fireCount: l.fireCount, result: result });
      }, function (err) {
        l.lastResult = { ok: false, at: Date.now(), error: String(err && err.message || err) };
        persistOne(id);
        emit('trigger:failed', id, { fireCount: l.fireCount, error: String(err && err.message || err) });
      });
  }

  function arm(id) {
    var l = live.get(id);
    if (!l) return;
    disarm(id, /*keepDef*/ true);
    if (!l.enabled) return;
    var def = l.def;
    if (def.type === 'interval') {
      l.timer = setInterval(function () { fire(id); }, def.intervalMs);
    } else if (def.type === 'at') {
      var delay = Math.max(0, def.at - Date.now());
      l.timer = setTimeout(function () { fire(id); }, delay);
    } else if (def.type === 'event') {
      l.offEvent = bus.on(def.eventType, function (env) {
        if (env.source === 'trigger-scheduler') return; // never react to our own emissions
        fire(id);
      });
    }
  }

  function disarm(id, keepDef) {
    var l = live.get(id);
    if (!l) return;
    if (l.timer) { clearInterval(l.timer); clearTimeout(l.timer); l.timer = null; }
    if (l.offEvent) { l.offEvent(); l.offEvent = null; }
    if (!keepDef) live.delete(id);
  }

  function schedule(spec) {
    spec = spec || {};
    var err = validate(spec);
    if (err) { emit('trigger:rejected', spec.id || null, { error: err }); return { ok: false, error: err }; }
    var id = spec.id || uid();
    if (live.has(id)) { var msg = 'A trigger with id "' + id + '" already exists.'; emit('trigger:rejected', id, { error: msg }); return { ok: false, error: msg }; }

    var def = {
      id: id, name: spec.name || id, type: spec.type,
      workflowId: spec.workflowId || null, skillId: spec.skillId || null,
      input: spec.input !== undefined ? spec.input : null,
      intervalMs: spec.intervalMs || null, at: spec.at || null, eventType: spec.eventType || null,
      priority: spec.priority || 'normal', retries: typeof spec.retries === 'number' ? spec.retries : 1,
      createdAt: Date.now()
    };
    live.set(id, { def: def, timer: null, offEvent: null, fireCount: 0, lastFiredAt: null, lastResult: null, enabled: spec.enabled !== false });
    persistOne(id);
    arm(id);
    emit('trigger:scheduled', id, { type: def.type, workflowId: def.workflowId, skillId: def.skillId });
    return { ok: true, id: id };
  }

  function cancel(id) {
    if (!live.has(id)) return false;
    disarm(id);
    var defs = loadDefs();
    delete defs[id];
    saveDefs(defs);
    emit('trigger:cancelled', id, {});
    return true;
  }

  function pause(id) {
    var l = live.get(id);
    if (!l) return false;
    l.enabled = false;
    disarm(id, true);
    persistOne(id);
    emit('trigger:paused', id, {});
    return true;
  }

  function resume(id) {
    var l = live.get(id);
    if (!l) return false;
    l.enabled = true;
    arm(id);
    persistOne(id);
    emit('trigger:resumed', id, {});
    return true;
  }

  function snapshotOf(id) {
    var l = live.get(id);
    if (!l) return null;
    return {
      id: id, name: l.def.name, type: l.def.type, workflowId: l.def.workflowId, skillId: l.def.skillId,
      enabled: l.enabled, fireCount: l.fireCount, lastFiredAt: l.lastFiredAt, lastResult: l.lastResult
    };
  }

  function getTrigger(id) { return snapshotOf(id); }
  function list() { return Array.from(live.keys()).map(snapshotOf); }

  return { schedule: schedule, cancel: cancel, pause: pause, resume: resume, getTrigger: getTrigger, list: list };
})();
