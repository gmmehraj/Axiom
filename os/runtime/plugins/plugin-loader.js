// ============================================================
// AXIOM AI OS — Milestone 14 Part 1: Plugin Loader
// ------------------------------------------------------------
// Objective 5: "Add Plugin Loader. Requirements: Lazy loading,
// Prevent duplicate loading, Error handling, Backward compatible."
//
// This module owns ONLY code instantiation + a cache. It never
// decides WHEN a plugin should load (that policy — dependency
// checks, retry/timeout, lifecycle state — lives in
// plugin-manager.js, reusing the existing Milestone 5
// AxiomCapabilityKit exactly like skill-registry.js already does).
// The loader's one job: given a plugin id and a factory, produce
// the plugin's module object AT MOST ONCE, no matter how many times
// or how concurrently it is asked to.
//
// - Lazy loading: a factory is never invoked until load(id, factory)
//   is actually called — nothing here runs at script-parse time.
// - Prevent duplicate loading: an in-flight load is de-duplicated
//   (a second concurrent load(id, ...) call gets the SAME promise,
//   never a second factory invocation), and an already-loaded id
//   short-circuits to the cached module instead of re-running the
//   factory.
// - Error handling: a throwing/rejecting factory clears in-flight
//   state (so a later retry is possible) and rejects the returned
//   promise — it never leaves the loader in a stuck "loading
//   forever" state.
// - Backward compatible: this file touches no existing runtime
//   module. It has zero dependencies (not even the Event Bus), so
//   it can be dropped in without disturbing load order elsewhere.
//
// Public surface — window.AxiomPluginLoader:
//   .load(id, factory, ctx) -> Promise<module>
//   .unload(id, ctx)         -> boolean   (runs module.onUnload(ctx) if present)
//   .isLoaded(id)            -> boolean
//   .isLoading(id)           -> boolean
//   .getModule(id)           -> module | null
// ============================================================
window.AxiomPluginLoader = (function () {
  'use strict';

  var cache = new Map();    // id -> { module, loadedAt }
  var inflight = new Map(); // id -> Promise<module>   (dedupe concurrent loads)

  function isLoaded(id) { return cache.has(id); }
  function isLoading(id) { return inflight.has(id); }
  function getModule(id) { return cache.has(id) ? cache.get(id).module : null; }

  function load(id, factory, ctx) {
    if (cache.has(id)) return Promise.resolve(cache.get(id).module); // already loaded — never re-run the factory
    if (inflight.has(id)) return inflight.get(id);                    // already loading — join the same promise

    var p = Promise.resolve()
      .then(function () {
        if (typeof factory === 'function') return factory(ctx);
        if (factory && typeof factory === 'object') return factory; // a plain module object is accepted as-is
        throw new Error('Plugin "' + id + '" has no loadable factory (expected a function or module object).');
      })
      .then(function (mod) {
        mod = mod || {};
        cache.set(id, { module: mod, loadedAt: Date.now() });
        inflight.delete(id);
        return mod;
      })
      .catch(function (err) {
        inflight.delete(id); // never leave a failed load stuck as "in-flight" — a later load() may retry
        throw err instanceof Error ? err : new Error(String(err));
      });

    inflight.set(id, p);
    return p;
  }

  function unload(id, ctx) {
    if (!cache.has(id)) return false;
    var entry = cache.get(id);
    cache.delete(id);
    if (entry.module && typeof entry.module.onUnload === 'function') {
      try { entry.module.onUnload(ctx); }
      catch (err) { AxLogger.error('[AxiomPluginLoader] plugin "' + id + '" threw during onUnload():', err); }
    }
    return true;
  }

  return {
    load: load,
    unload: unload,
    isLoaded: isLoaded,
    isLoading: isLoading,
    getModule: getModule
  };
})();
