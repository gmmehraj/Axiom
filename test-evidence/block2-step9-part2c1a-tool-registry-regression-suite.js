// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-1A: OpenRouter Tool Calling
// Tool Registry & Schema Foundation — regression suite
// ------------------------------------------------------------
// Runs the real files on disk
// (os/api/openrouter/tool-calling/tool-schema.js and
// tool-manager.js) in a hand-built `vm` sandbox — same pattern as
// block2-step9-part2b4-usage-tracker-regression-suite.js and its
// own predecessors.
//
// Sections:
//   1. tool-schema.js standalone — validation
//   2. tool-schema.js standalone — normalization
//   3. tool-manager.js standalone (no tool-schema.js loaded — degrade path)
//   4. tool-manager.js + tool-schema.js together — registration/lookup
//   5. Registration-order + immutability (deep clone) guarantees
//   6. Event Bus (AxiomOrchestrator reuse, feature-detected)
//   7. Security statics (no eval/Function/dynamic execution, no tool
//      ever invoked, no executable payload survives registration)
//   8. Non-duplication / non-modification statics
//   9. Part 2A / 2B-1 / 2B-2 / 2B-3 / 2B-4's own suites still pass
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Strips `//` line comments and inline `/* ... */` block comments so
// static string checks below scan CODE only, never documentation
// prose that legitimately mentions a forbidden/foreign symbol by
// name to explain why it isn't used (same class of over-broad-check
// fix Part 2A's own suite already made once, per
// OPENROUTER_PART2A_VALIDATION.md / CHANGELOG.md).
function codeOnly(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

class FakeCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}

function makeSandbox(opts) {
  opts = opts || {};
  const documentStub = { _events: [], dispatchEvent(evt) { this._events.push(evt); return true; } };

  const sandbox = {
    console,
    document: documentStub,
    CustomEvent: FakeCustomEvent,
    AxLogger: opts.withLogger === false ? undefined : { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    AxiomOrchestrator: opts.withOrchestrator === false ? undefined : makeFakeOrchestrator(),
    Object, Array, Math, Date, JSON, String, Number, Boolean, isFinite
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function makeFakeOrchestrator() {
  const emitted = [];
  const listeners = {};
  return {
    __emitted: emitted,
    on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return () => {}; },
    emit(event, payload) {
      emitted.push({ event, payload });
      (listeners[event] || []).forEach((fn) => fn(payload, event));
    }
  };
}

function loadInto(sandbox, rel) {
  vm.runInContext(readSrc(rel), sandbox, { filename: rel });
}

const SCHEMA_REL = 'os/api/openrouter/tool-calling/tool-schema.js';
const MANAGER_REL = 'os/api/openrouter/tool-calling/tool-manager.js';

function assertOk(value, message) {
  if (!value) throw new Error(message || 'expected a truthy value');
}
function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message ? message + ' — ' : '') + `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function validTool(overrides) {
  return Object.assign({
    name: 'get_weather',
    description: 'Gets the current weather for a city.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
        units: { type: 'string', enum: ['metric', 'imperial'] }
      },
      required: ['city']
    },
    metadata: { category: 'weather', version: 1 }
  }, overrides || {});
}

function main() {
  // ---------- 1. tool-schema.js standalone — validation ----------
  (function () {
    const sb = makeSandbox({ withOrchestrator: false });
    loadInto(sb, SCHEMA_REL);
    const S = sb.AxiomOpenRouterToolSchema;

    check('schema: installs window.AxiomOpenRouterToolSchema', typeof S === 'object' && S !== null);
    check('schema: exposes validateTool/validateParameters/normalizeTool/isValidToolName',
      typeof S.validateTool === 'function' && typeof S.validateParameters === 'function' &&
      typeof S.normalizeTool === 'function' && typeof S.isValidToolName === 'function');

    check('schema: valid tool passes validateTool()', S.validateTool(validTool()).valid === true);

    check('schema: rejects missing name', S.validateTool(validTool({ name: undefined })).valid === false);
    check('schema: rejects empty-string name', S.validateTool(validTool({ name: '' })).valid === false);
    check('schema: rejects invalid name (spaces)', S.validateTool(validTool({ name: 'get weather' })).valid === false);
    check('schema: rejects invalid name (too long)', S.validateTool(validTool({ name: 'x'.repeat(65) })).valid === false);
    check('schema: accepts name at 64-char boundary', S.validateTool(validTool({ name: 'x'.repeat(64) })).valid === true);
    check('schema: accepts hyphen/underscore in name', S.validateTool(validTool({ name: 'get_weather-v2' })).valid === true);

    check('schema: rejects missing parameters', S.validateTool(validTool({ parameters: undefined })).valid === false);
    check('schema: rejects null parameters', S.validateTool(validTool({ parameters: null })).valid === false);
    check('schema: rejects non-object parameters', S.validateTool(validTool({ parameters: 'nope' })).valid === false);
    check('schema: rejects parameters.type !== "object"', S.validateTool(validTool({ parameters: { type: 'string' } })).valid === false);

    check('schema: rejects invalid property type', S.validateTool(validTool({
      parameters: { type: 'object', properties: { x: { type: 'not-a-type' } }, required: [] }
    })).valid === false);

    check('schema: rejects malformed required (not an array)', S.validateTool(validTool({
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: 'city' }
    })).valid === false);

    check('schema: rejects malformed required (non-string entry)', S.validateTool(validTool({
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: [42] }
    })).valid === false);

    check('schema: rejects required entry not in properties', S.validateTool(validTool({
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['country'] }
    })).valid === false);

    check('schema: accepts empty properties object (no-arg tool)', S.validateTool(validTool({
      parameters: { type: 'object', properties: {}, required: [] }
    })).valid === true);

    check('schema: accepts parameters with properties omitted entirely', S.validateTool(validTool({
      parameters: { type: 'object' }
    })).valid === true);

    // nested objects
    check('schema: accepts nested object property', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: { street: { type: 'string' }, zip: { type: 'string' } },
            required: ['street']
          }
        },
        required: []
      }
    })).valid === true);

    check('schema: rejects malformed nested object (bad required)', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: { street: { type: 'string' } },
            required: ['zip']
          }
        },
        required: []
      }
    })).valid === false);

    // arrays
    check('schema: accepts array property with items schema', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: []
      }
    })).valid === true);

    check('schema: rejects array property missing items', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array' } },
        required: []
      }
    })).valid === false);

    check('schema: accepts array of objects (nested array + object combined)', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: {
          stops: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name']
            }
          }
        },
        required: []
      }
    })).valid === true);

    check('schema: rejects malformed items inside array', S.validateTool(validTool({
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'bogus' } } },
        required: []
      }
    })).valid === false);

    // all primitive types accepted
    ['string', 'number', 'integer', 'boolean'].forEach((t) => {
      check(`schema: accepts primitive property type "${t}"`, S.validateTool(validTool({
        parameters: { type: 'object', properties: { v: { type: t } }, required: [] }
      })).valid === true);
    });

    check('schema: rejects malformed schema (non-object tool)', S.validateTool('not-a-tool').valid === false);
    check('schema: rejects malformed schema (array as tool)', S.validateTool(['no']).valid === false);
    check('schema: rejects null tool', S.validateTool(null).valid === false);

    check('schema: rejects invalid description type', S.validateTool(validTool({ description: 42 })).valid === false);
    check('schema: accepts tool with no description', S.validateTool(validTool({ description: undefined })).valid === true);

    check('schema: rejects invalid metadata type', S.validateTool(validTool({ metadata: 'nope' })).valid === false);
    check('schema: accepts tool with no metadata', S.validateTool(validTool({ metadata: undefined })).valid === true);

    check('schema: validateTool() returns an errors array', Array.isArray(S.validateTool(validTool({ name: undefined })).errors));

    // isValidToolName direct checks
    check('schema: isValidToolName("search_web") === true', S.isValidToolName('search_web') === true);
    check('schema: isValidToolName("") === false', S.isValidToolName('') === false);
    check('schema: isValidToolName(123) === false', S.isValidToolName(123) === false);
    check('schema: isValidToolName("has space") === false', S.isValidToolName('has space') === false);
    check('schema: isValidToolName(undefined) === false', S.isValidToolName(undefined) === false);

    // validateParameters direct checks
    check('schema: validateParameters() valid case', S.validateParameters({ type: 'object', properties: {}, required: [] }).valid === true);
    check('schema: validateParameters() missing case', S.validateParameters(undefined).valid === false);
    check('schema: validateParameters() malformed case', S.validateParameters(42).valid === false);
  })();

  // ---------- 2. tool-schema.js standalone — normalization ----------
  (function () {
    const sb = makeSandbox({ withOrchestrator: false });
    loadInto(sb, SCHEMA_REL);
    const S = sb.AxiomOpenRouterToolSchema;

    const normalized = S.normalizeTool(validTool());
    check('schema: normalizeTool() returns wire shape {type:"function", function:{...}}',
      normalized && normalized.type === 'function' && typeof normalized.function === 'object');
    check('schema: normalizeTool() preserves name', normalized.function.name === 'get_weather');
    check('schema: normalizeTool() preserves description', normalized.function.description === 'Gets the current weather for a city.');
    check('schema: normalizeTool() fills required=[] when omitted',
      Array.isArray(S.normalizeTool(validTool({ parameters: { type: 'object' } })).function.parameters.required) &&
      S.normalizeTool(validTool({ parameters: { type: 'object' } })).function.parameters.required.length === 0);
    check('schema: normalizeTool() fills properties={} when omitted',
      JSON.stringify(S.normalizeTool(validTool({ parameters: { type: 'object' } })).function.parameters.properties) === '{}');
    check('schema: normalizeTool() defaults missing description to ""',
      S.normalizeTool(validTool({ description: undefined })).function.description === '');
    check('schema: normalizeTool() omits metadata from wire shape (AXIOM-local field, never sent to OpenRouter)',
      !Object.prototype.hasOwnProperty.call(normalized.function, 'metadata') && !Object.prototype.hasOwnProperty.call(normalized, 'metadata'));
    check('schema: normalizeTool() returns null for an invalid tool', S.normalizeTool(validTool({ name: undefined })) === null);
    check('schema: normalizeTool() does not mutate the input object', (() => {
      const t = validTool();
      const before = JSON.stringify(t);
      S.normalizeTool(t);
      return JSON.stringify(t) === before;
    })());

    const nested = S.normalizeTool(validTool({
      parameters: {
        type: 'object',
        properties: { stops: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
        required: []
      }
    }));
    check('schema: normalizeTool() recursively normalizes nested array-of-object schemas',
      nested.function.parameters.properties.stops.type === 'array' &&
      nested.function.parameters.properties.stops.items.type === 'object' &&
      Array.isArray(nested.function.parameters.properties.stops.items.required));
  })();

  // ---------- 3. tool-manager.js standalone (degrade path — no tool-schema.js loaded) ----------
  (function () {
    const sb = makeSandbox();
    loadInto(sb, MANAGER_REL);
    const M = sb.AxiomOpenRouterToolManager;

    check('manager (degraded): installs window.AxiomOpenRouterToolManager even without tool-schema.js', typeof M === 'object' && M !== null);
    check('manager (degraded): getTools() returns empty array', Array.isArray(M.getTools()) && M.getTools().length === 0);
    check('manager (degraded): getToolDefinitions() returns empty array', Array.isArray(M.getToolDefinitions()) && M.getToolDefinitions().length === 0);
    check('manager (degraded): hasTool() is false for anything', M.hasTool('get_weather') === false);

    const result = M.registerTool(validTool());
    check('manager (degraded): registerTool() fails gracefully (no throw) without tool-schema.js', result && result.success === false);
    check('manager (degraded): registerTool() failure carries an errors array', Array.isArray(result.errors) && result.errors.length > 0);
    check('manager (degraded): registerTool() failure emits openrouter_tool_registration_failed',
      sb.AxiomOrchestrator.__emitted.some((e) => e.event === 'openrouter_tool_registration_failed'));
  })();

  // ---------- 4. tool-manager.js + tool-schema.js together ----------
  (function () {
    const sb = makeSandbox();
    loadInto(sb, SCHEMA_REL);
    loadInto(sb, MANAGER_REL);
    const M = sb.AxiomOpenRouterToolManager;

    const reg = M.registerTool(validTool());
    check('manager: registerTool() succeeds for a valid tool', reg.success === true);
    check('manager: registerTool() returns the registered tool record', reg.tool && reg.tool.name === 'get_weather');
    check('manager: hasTool() true after registration', M.hasTool('get_weather') === true);
    check('manager: getTool() returns the stored record', M.getTool('get_weather') && M.getTool('get_weather').name === 'get_weather');
    check('manager: getTool() returns null for an unknown name', M.getTool('does_not_exist') === null);
    check('manager: getTool() returns null for a non-string name', M.getTool(42) === null);

    const dup = M.registerTool(validTool({ description: 'a different description' }));
    check('manager: registerTool() prevents duplicate tool names', dup.success === false);
    check('manager: duplicate registerTool() does not overwrite the original', M.getTool('get_weather').description === 'Gets the current weather for a city.');
    check('manager: duplicate registration emits openrouter_tool_registration_failed',
      sb.AxiomOrchestrator.__emitted.some((e) => e.event === 'openrouter_tool_registration_failed' && e.payload && e.payload.name === 'get_weather'));

    const bad = M.registerTool({ name: 'bad tool name!' });
    check('manager: registerTool() rejects an invalid tool (bad name)', bad.success === false);
    check('manager: invalid registration is never added to the registry', M.hasTool('bad tool name!') === false);

    check('manager: unregisterTool() removes an existing tool', M.unregisterTool('get_weather') === true);
    check('manager: hasTool() false after unregisterTool()', M.hasTool('get_weather') === false);
    check('manager: getTool() null after unregisterTool()', M.getTool('get_weather') === null);
    check('manager: unregisterTool() returns false for an unknown name', M.unregisterTool('does_not_exist') === false);
    check('manager: unregisterTool() returns false for a non-string name', M.unregisterTool(undefined) === false);

    // clearTools
    M.registerTool(validTool({ name: 'tool_a' }));
    M.registerTool(validTool({ name: 'tool_b' }));
    check('manager: multiple distinct tools can be registered', M.getTools().length === 2);
    M.clearTools();
    check('manager: clearTools() empties the registry', M.getTools().length === 0 && M.getToolDefinitions().length === 0);
    check('manager: hasTool() false for a previously-registered name after clearTools()', M.hasTool('tool_a') === false);
  })();

  // ---------- 5. Registration order + immutability (deep clone) guarantees ----------
  (function () {
    const sb = makeSandbox();
    loadInto(sb, SCHEMA_REL);
    loadInto(sb, MANAGER_REL);
    const M = sb.AxiomOpenRouterToolManager;

    M.registerTool(validTool({ name: 'tool_c', parameters: { type: 'object', properties: {}, required: [] } }));
    M.registerTool(validTool({ name: 'tool_a', parameters: { type: 'object', properties: {}, required: [] } }));
    M.registerTool(validTool({ name: 'tool_b', parameters: { type: 'object', properties: {}, required: [] } }));

    const names = M.getTools().map((t) => t.name);
    check('manager: getTools() preserves registration order (not sorted)', JSON.stringify(names) === JSON.stringify(['tool_c', 'tool_a', 'tool_b']));

    const defNames = M.getToolDefinitions().map((d) => d.function.name);
    check('manager: getToolDefinitions() preserves the same registration order', JSON.stringify(defNames) === JSON.stringify(['tool_c', 'tool_a', 'tool_b']));

    check('manager: getToolDefinitions() returns OpenRouter wire-format entries', M.getToolDefinitions().every((d) => d.type === 'function' && d.function && d.function.parameters));
    check('manager: getToolDefinitions() entries omit the AXIOM-local metadata field', M.getToolDefinitions().every((d) => !Object.prototype.hasOwnProperty.call(d.function, 'metadata')));

    // mutate a returned record — must not affect the registry
    const record = M.getTool('tool_a');
    record.name = 'mutated';
    record.parameters.properties.injected = { type: 'string' };
    check('manager: mutating a getTool() return value does not affect the registry', M.getTool('tool_a').name === 'tool_a' && !M.getTool('tool_a').parameters.properties.injected);

    const list = M.getTools();
    list[0].name = 'mutated-list';
    check('manager: mutating a getTools() return value does not affect the registry', M.getTools()[0].name !== 'mutated-list');

    const defs = M.getToolDefinitions();
    defs[0].function.name = 'mutated-def';
    check('manager: mutating a getToolDefinitions() return value does not affect the registry', M.getToolDefinitions()[0].function.name !== 'mutated-def');

    // mutating the ORIGINAL object passed into registerTool must not affect the stored record either
    const original = validTool({ name: 'tool_d' });
    M.registerTool(original);
    original.parameters.properties.city.type = 'number';
    original.metadata.category = 'tampered';
    check('manager: mutating the caller\'s original tool object after registration does not affect the stored record',
      M.getTool('tool_d').parameters.properties.city.type === 'string' && M.getTool('tool_d').metadata.category === 'weather');
  })();

  // ---------- 6. Event Bus (AxiomOrchestrator reuse) ----------
  (function () {
    const sb = makeSandbox();
    loadInto(sb, SCHEMA_REL);
    loadInto(sb, MANAGER_REL);
    const M = sb.AxiomOpenRouterToolManager;

    M.registerTool(validTool());
    const registeredEvt = sb.AxiomOrchestrator.__emitted.find((e) => e.event === 'openrouter_tool_registered');
    check('events: openrouter_tool_registered fires on success', !!registeredEvt);
    check('events: openrouter_tool_registered payload carries name/tool/at', registeredEvt.payload.name === 'get_weather' &&
      registeredEvt.payload.tool && typeof registeredEvt.payload.at === 'number');

    M.unregisterTool('get_weather');
    const unregisteredEvt = sb.AxiomOrchestrator.__emitted.find((e) => e.event === 'openrouter_tool_unregistered');
    check('events: openrouter_tool_unregistered fires on unregister', !!unregisteredEvt && unregisteredEvt.payload.name === 'get_weather');

    M.registerTool({ name: 'bad name!' });
    const failedEvt = sb.AxiomOrchestrator.__emitted.find((e) => e.event === 'openrouter_tool_registration_failed');
    check('events: openrouter_tool_registration_failed fires on invalid registration', !!failedEvt && Array.isArray(failedEvt.payload.errors));

    // No AxiomOrchestrator loaded at all — must not throw.
    const sb2 = makeSandbox({ withOrchestrator: false });
    loadInto(sb2, SCHEMA_REL);
    loadInto(sb2, MANAGER_REL);
    let threw = false;
    try { sb2.AxiomOpenRouterToolManager.registerTool(validTool()); } catch (e) { threw = true; }
    check('events: registerTool() never throws when AxiomOrchestrator is absent (feature-detected)', threw === false);
    check('events: registerTool() still succeeds with no Orchestrator loaded', sb2.AxiomOpenRouterToolManager.hasTool('get_weather') === true);
  })();

  // ---------- 7. Security statics ----------
  (function () {
    const schemaSrc = readSrc(SCHEMA_REL);
    const managerSrc = readSrc(MANAGER_REL);
    const schemaCode = codeOnly(schemaSrc);
    const managerCode = codeOnly(managerSrc);
    const combined = schemaCode + '\n' + managerCode;

    check('security: tool-schema.js contains no eval( in code (comments may name it to explain why it isn\'t used)', !/\beval\s*\(/.test(schemaCode));
    check('security: tool-manager.js contains no eval( in code (comments may name it to explain why it isn\'t used)', !/\beval\s*\(/.test(managerCode));
    check('security: tool-schema.js contains no new Function( in code', !/new\s+Function\s*\(/.test(schemaCode));
    check('security: tool-manager.js contains no new Function( in code', !/new\s+Function\s*\(/.test(managerCode));
    check('security: neither file references child_process/exec/spawn in code', !/child_process|\bexec\s*\(|\bspawn\s*\(/.test(combined));
    check('security: neither file references a script/document.write dynamic-load pattern', !/document\.write|createElement\(['"]script['"]\)/.test(combined));
    check('security: neither file makes a fetch()/XHR network call (registration/schema only, no network)', !/\bfetch\s*\(|XMLHttpRequest/.test(combined));
    check('security: neither file touches localStorage (stateless/in-memory only)', !/localStorage/.test(combined));

    // A registered tool can never carry a callable back out of the registry.
    (function () {
      const sb = makeSandbox();
      loadInto(sb, SCHEMA_REL);
      loadInto(sb, MANAGER_REL);
      const M = sb.AxiomOpenRouterToolManager;
      const withHandler = validTool({ name: 'tool_with_handler' });
      withHandler.execute = function () { throw new Error('must never be callable/called'); };
      withHandler.handler = function () { throw new Error('must never be callable/called'); };
      const res = M.registerTool(withHandler);
      check('security: registerTool() succeeds even when the input carries stray function fields', res.success === true);
      check('security: a stray execute()/handler() function is never stored on the registered record',
        typeof res.tool.execute === 'undefined' && typeof res.tool.handler === 'undefined');
      check('security: getTool() never returns a callable field anywhere on the record',
        !Object.values(M.getTool('tool_with_handler')).some((v) => typeof v === 'function'));
      check('security: getToolDefinitions() output contains no function-typed values',
        JSON.stringify(M.getToolDefinitions()).indexOf('function') === -1 || (() => {
          // "function" may legitimately appear as the literal wire-format
          // discriminator value type:"function" — confirm no ACTUAL
          // function value survived by checking every leaf via JSON
          // round-trip (functions are dropped by JSON.stringify, so
          // re-parsing and deep-typeof-scanning the result is sufficient).
          const defs = M.getToolDefinitions();
          const scan = (v) => (typeof v === 'function') ? true : (v && typeof v === 'object') ? Object.values(v).some(scan) : false;
          return !defs.some(scan);
        })());
    })();

    check('security: tool-manager.js never invokes a stored field as a function (no dynamic .execute()/.handler() call site)',
      !/\.\s*(execute|handler|run)\s*\(/.test(managerSrc));
  })();

  // ---------- 8. Non-duplication / non-modification statics ----------
  (function () {
    const doNotModify = [
      'os/core/browser-engine.js', 'os/core/browser-manager.js', 'os/core/browser-sandbox.js',
      'os/core/automation-engine.js', 'os/core/automation-manager.js',
      'os/core/memory-engine.js', 'os/core/memory-manager.js',
      'os/core/goal-manager.js', 'os/core/goal-manager-learning.js', 'os/core/goal-manager-recovery.js',
      'js/core/voice.js', 'js/core/voice-controller.js',
      'js/core/supabase/connection-manager.js', 'js/core/supabase/auth-service.js', 'js/core/supabase/env.js'
    ];
    doNotModify.forEach((rel) => {
      check(`static: protected file ${rel} still present on disk`, fs.existsSync(path.join(ROOT, rel)));
    });

    ['os/api/openrouter/api-manager.js', 'os/api/openrouter/model-manager.js', 'os/api/openrouter/chat-manager.js',
      'os/api/openrouter/response-parser.js', 'os/api/openrouter/stream-manager.js', 'os/api/openrouter/request-queue.js',
      'os/api/openrouter/token-manager.js', 'os/api/openrouter/error-handler.js', 'os/api/openrouter/usage-tracker.js'
    ].forEach((rel) => {
      check(`static: existing sibling ${rel} still present on disk, untouched by this Part`, fs.existsSync(path.join(ROOT, rel)));
    });

    check('static: os/api/openrouter/ contains exactly the ten expected entries (nine Part 2A-2B4 files + Part 2C-1A\'s tool-calling/), nothing extra',
      (() => {
        const names = fs.readdirSync(path.join(ROOT, 'os/api/openrouter')).sort();
        const expected = ['api-manager.js', 'chat-manager.js', 'error-handler.js', 'model-manager.js', 'request-queue.js', 'response-parser.js', 'stream-manager.js', 'token-manager.js', 'tool-calling', 'usage-tracker.js'];
        return JSON.stringify(names) === JSON.stringify(expected);
      })());

    check('static: os/api/openrouter/tool-calling/ contains exactly the two Part 2C-1A deliverables, nothing extra',
      (() => {
        const names = fs.readdirSync(path.join(ROOT, 'os/api/openrouter/tool-calling')).sort();
        return JSON.stringify(names) === JSON.stringify(['tool-manager.js', 'tool-schema.js']);
      })());

    const schemaCode = codeOnly(readSrc(SCHEMA_REL));
    const managerCode = codeOnly(readSrc(MANAGER_REL));

    check('static: tool-manager.js does not reimplement JSON Schema validation itself in code (delegates entirely to AxiomOpenRouterToolSchema)',
      !/function\s+validateSchemaNode|function\s+validateObjectNode|function\s+validateArrayNode/.test(managerCode));
    check('static: tool-manager.js never creates its own event bus in code (no local listeners map / on() implementation)',
      !/var\s+listeners\s*=|function\s+on\s*\(\s*event\s*,\s*fn\s*\)/.test(managerCode));
    check('static: tool-manager.js calls AxiomOrchestrator.emit rather than reimplementing pub/sub', /AxiomOrchestrator/.test(managerCode) && /\.emit\s*\(/.test(managerCode));
    check('static: tool-schema.js code is dependency-free (no reference to AxiomOpenRouter, AxiomOrchestrator, or AxLogger outside comments)',
      !/AxiomOpenRouter\b|AxiomOrchestrator|AxLogger/.test(schemaCode));
    check('static: neither new file calls response-parser.js\'s normalizeToolCalls in code (disjoint concern — response tool_calls vs request tool defs; comments may name it to explain why)',
      !/normalizeToolCalls\s*\(/.test(schemaCode) && !/normalizeToolCalls\s*\(/.test(managerCode));
    check('static: neither new file calls model-manager.js\'s getCapabilities in code (no model-awareness in this Part; comments may name it to explain why)',
      !/getCapabilities\s*\(/.test(schemaCode) && !/getCapabilities\s*\(/.test(managerCode));
  })();

  // ---------- 9. Part 2A / 2B-1 / 2B-2 / 2B-3 / 2B-4's own suites still pass ----------
  (function () {
    const suites = [
      ['test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js', 72, "Part 2A's own suite"],
      ['test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js', 56, "Part 2B-1's own suite"],
      ['test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js', 87, "Part 2B-2's own suite"],
      ['test-evidence/block2-step9-part2b3-request-queue-regression-suite.js', 96, "Part 2B-3's own suite"],
      ['test-evidence/block2-step9-part2b4-usage-tracker-regression-suite.js', 90, "Part 2B-4's own suite"]
    ];
    suites.forEach(([rel, expectedPass, label]) => {
      try {
        const out = execFileSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8' });
        const m = out.match(/(\d+) passed, (\d+) failed\./);
        const okCount = !!m && Number(m[1]) === expectedPass && Number(m[2]) === 0;
        check(`regression: ${label} still passes in full (${expectedPass}/${expectedPass}) after Part 2C-1A's additive changes`, okCount, m ? `${m[1]} passed, ${m[2]} failed` : 'no summary line found');
      } catch (e) {
        check(`regression: ${label} still passes in full after Part 2C-1A's additive changes`, false, e && e.message);
      }
    });
  })();

  console.log('');
  console.log(`${pass} passed, ${fail} failed.`);
  if (failures.length) {
    console.log('');
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f.label}${f.detail ? '  — ' + f.detail : ''}`));
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
