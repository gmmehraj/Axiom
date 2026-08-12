// ============================================================
// AXIOM AI OS — Milestone 5: Capability Kit
// ------------------------------------------------------------
// One shared wrapper that every agent capability (Browser, Memory,
// Planner, File, ...) runs through, so "every capability must
// support loading / success / failure / retry / timeout /
// cancellation" (Step 6) is satisfied ONCE, structurally, instead
// of being re-implemented per agent.
//
// It never throws past the caller unexpectedly: it settles the
// promise it returns and always emits a matching structured event
// on the shared agent bus, so the OS (or any UI) can observe a
// capability's lifecycle without polling.
//
// Public surface — window.AxiomCapabilityKit:
//   .withCapability(name, task, ctx, fn, opts) -> Promise<result>
// ============================================================
window.AxiomCapabilityKit = (function () {
  'use strict';

  function withCapability(name, task, ctx, fn, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    var retries = typeof opts.retries === 'number' ? opts.retries : 1; // total attempts
    var bus = (ctx && ctx.bus) || (window.AxiomAgentRuntime && window.AxiomAgentRuntime.bus);
    var agentId = (ctx && ctx.agent && ctx.agent.id) || 'unknown-agent';
    var taskId = task && task.id;

    function emit(type, extra) {
      if (!bus) return;
      bus.emit(type, agentId, Object.assign({ capability: name, task: taskId }, extra || {}));
    }

    function isCancelled() { return !!(task && task.cancelled); }

    function attempt(n) {
      emit('capability:loading', { attempt: n });
      if (isCancelled()) {
        emit('capability:cancelled', { attempt: n });
        return Promise.reject(new Error(name + ' was cancelled.'));
      }
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          emit('capability:timeout', { attempt: n, timeoutMs: timeoutMs });
          reject(new Error(name + ' timed out after ' + timeoutMs + 'ms'));
        }, timeoutMs);

        Promise.resolve().then(fn).then(function (result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (isCancelled()) {
            emit('capability:cancelled', { attempt: n });
            reject(new Error(name + ' was cancelled.'));
            return;
          }
          resolve(result);
        }, function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    function run(n) {
      return attempt(n).then(function (result) {
        emit('capability:success', { attempt: n });
        return result;
      }, function (err) {
        var cancelled = isCancelled() || /was cancelled\.$/.test(String(err && err.message));
        if (cancelled) throw err; // never retry a cancellation
        if (n < retries) {
          emit('capability:retry', { attempt: n, error: String(err && err.message || err) });
          return run(n + 1);
        }
        emit('capability:failure', { attempt: n, error: String(err && err.message || err) });
        throw err;
      });
    }

    return run(1);
  }

  return { withCapability: withCapability };
})();
