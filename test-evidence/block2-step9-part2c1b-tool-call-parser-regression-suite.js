// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-1B: OpenRouter Tool Calling
// Tool Call Parser — regression suite
// ------------------------------------------------------------
// Runs the real file on disk
// (os/api/openrouter/tool-calling/tool-call-parser.js), together
// with its Part 2C-1A dependencies (tool-schema.js, tool-manager.js),
// in a hand-built `vm` sandbox — same pattern as
// block2-step9-part2c1a-tool-registry-regression-suite.js and its
// own predecessors.
//
// Sections:
//   1. parseToolCall() — single call normalization
//   2. parseToolCalls() — multiple calls, order, never-discard
//   3. Argument parsing (valid/empty/malformed/null/string/object)
//   4. Unknown tool / missing name / missing id
//   5. Streaming accumulation (createAccumulator)
//   6. Events (AxiomOrchestrator reuse, feature-detected)
//   7. Schema validation (validateToolCall, registry-aware)
//   8. Security statics
//   9. Non-duplication / non-modification statics
//  10. Backward compatibility — Part 2C-1A / 2B-4 / 2B-3 / 2B-2 /
//      2B-1 / 2A's own suites still pass
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
// prose that legitimately mentions a forbidden/foreign symbol by name
// to explain why it isn't used — same convention Part 2C-1A's own
// suite uses (codeOnly()).
function codeOnly(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

class FakeCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
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

function loadInto(sandbox, rel) {
  vm.runInContext(readSrc(rel), sandbox, { filename: rel });
}

const SCHEMA_REL = 'os/api/openrouter/tool-calling/tool-schema.js';
const MANAGER_REL = 'os/api/openrouter/tool-calling/tool-manager.js';
const PARSER_REL = 'os/api/openrouter/tool-calling/tool-call-parser.js';

function fullSandbox(opts) {
  const sb = makeSandbox(opts);
  loadInto(sb, SCHEMA_REL);
  loadInto(sb, MANAGER_REL);
  loadInto(sb, PARSER_REL);
  return sb;
}

function validTool(overrides) {
  return Object.assign({
    name: 'get_weather',
    description: 'Gets the current weather for a city.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
        units: { type: 'string', enum: ['metric', 'imperial'] },
        days: { type: 'integer' }
      },
      required: ['city']
    },
    metadata: { category: 'weather' }
  }, overrides || {});
}

function main() {
  // ---------- 1. parseToolCall() — single call normalization ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;

    check('parser: installs window.AxiomOpenRouterToolCallParser', typeof P === 'object' && P !== null);
    check('parser: exposes parseToolCall/parseToolCalls/validateToolCall/createAccumulator',
      typeof P.parseToolCall === 'function' && typeof P.parseToolCalls === 'function' &&
      typeof P.validateToolCall === 'function' && typeof P.createAccumulator === 'function');

    const raw = { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } };
    const parsed = P.parseToolCall(raw);
    check('parser: parseToolCall() extracts id', parsed.id === 'call_1');
    check('parser: parseToolCall() extracts name', parsed.name === 'get_weather');
    check('parser: parseToolCall() parses arguments to an object', typeof parsed.arguments === 'object' && parsed.arguments.city === 'Paris');
    check('parser: parseToolCall() carries no parseError on valid JSON', parsed.parseError === null);
    check('parser: parseToolCall() preserves raw', parsed.raw && parsed.raw.id === 'call_1');

    const viaToolCallId = P.parseToolCall({ tool_call_id: 'call_alt', function: { name: 'x', arguments: '{}' } });
    check('parser: parseToolCall() accepts tool_call_id spelling', viaToolCallId.id === 'call_alt');

    check('parser: parseToolCall() never throws on undefined input', (() => { try { P.parseToolCall(undefined); return true; } catch (e) { return false; } })());
    check('parser: parseToolCall() never throws on null input', (() => { try { P.parseToolCall(null); return true; } catch (e) { return false; } })());
    check('parser: parseToolCall() never throws on a non-object input', (() => { try { P.parseToolCall('nope'); return true; } catch (e) { return false; } })());
  })();

  // ---------- 2. parseToolCalls() — multiple calls, order, never-discard ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;

    const raws = [
      { id: 'c1', function: { name: 'tool_a', arguments: '{"x":1}' } },
      { id: 'c2', function: { name: 'tool_b', arguments: '{"y":2}' } },
      { id: 'c3', function: { name: 'tool_c', arguments: 'not json' } }
    ];
    const results = P.parseToolCalls(raws);
    check('parser: parseToolCalls() returns one entry per input, in order', results.length === 3 &&
      results[0].name === 'tool_a' && results[1].name === 'tool_b' && results[2].name === 'tool_c');
    check('parser: parseToolCalls() never discards an entry even when one is malformed', results.length === raws.length);
    check('parser: parseToolCalls() preserves tool_call ids across entries', results[0].id === 'c1' && results[1].id === 'c2' && results[2].id === 'c3');
    check('parser: parseToolCalls() returns [] for non-array input', Array.isArray(P.parseToolCalls(undefined)) && P.parseToolCalls(undefined).length === 0);
  })();

  // ---------- 3. Argument parsing ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;

    const validJson = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: '{"a":1,"b":"two"}' } });
    check('args: valid JSON arguments parsed correctly', validJson.arguments.a === 1 && validJson.arguments.b === 'two' && validJson.parseError === null);

    const emptyStr = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: '' } });
    check('args: empty-string arguments -> {} with no error', Object.keys(emptyStr.arguments).length === 0 && emptyStr.parseError === null);

    const undefinedArgs = P.parseToolCall({ id: 'a', function: { name: 'n' } });
    check('args: undefined arguments -> {} with no error', Object.keys(undefinedArgs.arguments).length === 0 && undefinedArgs.parseError === null);

    const nullArgs = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: null } });
    check('args: null arguments -> {} with no error', Object.keys(nullArgs.arguments).length === 0 && nullArgs.parseError === null);

    const malformed = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: '{"a": ' } });
    check('args: malformed JSON produces a controlled parse error (no throw)', typeof malformed.parseError === 'string' && malformed.parseError.length > 0);
    check('args: malformed JSON still yields a safe {} arguments default', Object.keys(malformed.arguments).length === 0);

    const objArgs = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: { already: 'object' } } });
    check('args: pre-parsed object arguments are accepted as-is', objArgs.arguments.already === 'object' && objArgs.parseError === null);

    const arrArgs = P.parseToolCall({ id: 'a', function: { name: 'n', arguments: '[1,2,3]' } });
    check('args: a JSON array (not object) is a controlled parse error', typeof arrArgs.parseError === 'string');

    check('args: parseToolCall() never executes/evaluates the arguments string', (() => {
      let sideEffect = false;
      global.__parserTestSideEffect = () => { sideEffect = true; };
      P.parseToolCall({ id: 'a', function: { name: 'n', arguments: '{"__proto__":{}}' } });
      delete global.__parserTestSideEffect;
      return sideEffect === false;
    })());
  })();

  // ---------- 4. Unknown tool / missing name / missing id ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;
    sb.AxiomOpenRouterToolManager.registerTool(validTool());

    const missingName = P.parseToolCall({ id: 'a', function: { arguments: '{}' } });
    check('missing name: parseToolCall() defaults name to empty string (no throw)', missingName.name === '');
    const missingNameValidation = P.validateToolCall(missingName);
    check('missing name: validateToolCall() reports invalid with a "name" error', missingNameValidation.valid === false && missingNameValidation.errors.some((e) => /name/.test(e)));

    const missingId = P.parseToolCall({ function: { name: 'get_weather', arguments: '{"city":"Rome"}' } });
    check('missing id: parseToolCall() defaults id to null (no throw)', missingId.id === null);
    check('missing id: parseToolCall() still parses a usable call', missingId.name === 'get_weather' && missingId.arguments.city === 'Rome');

    const unknown = P.parseToolCall({ id: 'a', function: { name: 'not_registered', arguments: '{}' } });
    const unknownValidation = P.validateToolCall(unknown);
    check('unknown tool: validateToolCall() reports invalid', unknownValidation.valid === false);
    check('unknown tool: validateToolCall() error names the unknown tool', unknownValidation.errors.some((e) => e.indexOf('not_registered') !== -1));
  })();

  // ---------- 5. Streaming accumulation ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;
    sb.AxiomOpenRouterToolManager.registerTool(validTool());

    const acc = P.createAccumulator();
    check('streaming: createAccumulator() returns addDeltas/getPartials/finalize/reset', typeof acc.addDeltas === 'function' && typeof acc.getPartials === 'function' &&
      typeof acc.finalize === 'function' && typeof acc.reset === 'function');

    // Chunk 1: id + name arrive, arguments start. "Sufficient data" is
    // id+name (needed to identify/correlate the call); finalize()
    // called this early still produces an entry, but with a
    // *controlled* parse error since the JSON fragment is genuinely
    // incomplete — the same non-throwing behavior Section 3 requires,
    // rather than the accumulator silently guessing JSON completeness.
    acc.addDeltas([{ index: 0, id: 'call_9', type: 'function', function: { name: 'get_weather', arguments: '{"cit' } }]);
    const earlyFinalize = acc.finalize();
    check('streaming: finalizing before arguments JSON is complete still returns the call, with a controlled parse error (not a throw, not silently dropped)',
      earlyFinalize.length === 1 && typeof earlyFinalize[0].parseError === 'string');

    // Chunk 2: more of the arguments fragment
    acc.addDeltas([{ index: 0, function: { arguments: 'y":"Berl' } }]);
    let partials = acc.getPartials();
    check('streaming: getPartials() reflects accumulated-so-far raw fragments', partials.length === 1 && partials[0].function.arguments === '{"city":"Berl');
    check('streaming: id is preserved across chunks that omit it', partials[0].id === 'call_9');

    // Chunk 3: closes the JSON
    acc.addDeltas([{ index: 0, function: { arguments: 'in"}' } }]);
    const finalized = acc.finalize();
    check('streaming: finalize() produces exactly one completed call once sufficient data exists', finalized.length === 1);
    check('streaming: finalized call has correctly merged id/name', finalized[0].id === 'call_9' && finalized[0].name === 'get_weather');
    check('streaming: finalized call has correctly assembled + parsed arguments', finalized[0].arguments.city === 'Berlin' && finalized[0].parseError === null);

    // Multiple concurrent tool calls by index
    const acc2 = P.createAccumulator();
    acc2.addDeltas([
      { index: 0, id: 'call_a', function: { name: 'tool_a', arguments: '{}' } },
      { index: 1, id: 'call_b', function: { name: 'tool_b', arguments: '{}' } }
    ]);
    const finalized2 = acc2.finalize();
    check('streaming: multiple concurrent indices finalize independently', finalized2.length === 2 &&
      finalized2.some((c) => c.id === 'call_a') && finalized2.some((c) => c.id === 'call_b'));

    // A partial with an id but no name yet must never finalize
    const acc3 = P.createAccumulator();
    acc3.addDeltas([{ index: 0, id: 'call_only_id', function: { arguments: '{}' } }]);
    check('streaming: insufficient data (no function name yet) never finalizes', acc3.finalize().length === 0);

    // reset() clears accumulated state
    acc3.reset();
    check('streaming: reset() clears accumulated partials', acc3.getPartials().length === 0);

    check('streaming: does not throw on a non-array addDeltas() input', (() => { try { P.createAccumulator().addDeltas('nope'); return true; } catch (e) { return false; } })());
  })();

  // ---------- 6. Events ----------
  (function () {
    const sb = fullSandbox();
    const P = sb.AxiomOpenRouterToolCallParser;
    sb.AxiomOpenRouterToolManager.registerTool(validTool());
    sb.AxiomOrchestrator.__emitted.length = 0; // clear the registerTool()'s own openrouter_tool_registered event

    P.parseToolCall({ id: 'e1', function: { name: 'get_weather', arguments: '{"city":"Kyoto"}' } });
    check('events: parseToolCall() alone does not itself emit (only parseToolCalls()/finalize() drive events)',
      sb.AxiomOrchestrator.__emitted.length === 0);

    sb.AxiomOrchestrator.__emitted.length = 0;
    P.parseToolCalls([{ id: 'e2', function: { name: 'get_weather', arguments: '{"city":"Lima"}' } }]);
    const names = sb.AxiomOrchestrator.__emitted.map((e) => e.event);
    check('events: openrouter_tool_call_detected fires', names.includes('openrouter_tool_call_detected'));
    check('events: openrouter_tool_call_parsed fires on clean parse', names.includes('openrouter_tool_call_parsed'));
    check('events: openrouter_tool_call_parse_failed does NOT fire on a clean parse', !names.includes('openrouter_tool_call_parse_failed'));

    sb.AxiomOrchestrator.__emitted.length = 0;
    P.parseToolCalls([{ id: 'e3', function: { name: 'get_weather', arguments: '{bad json' } }]);
    const names2 = sb.AxiomOrchestrator.__emitted.map((e) => e.event);
    check('events: openrouter_tool_call_parse_failed fires on malformed JSON', names2.includes('openrouter_tool_call_parse_failed'));
    check('events: openrouter_tool_call_parsed does NOT fire on a failed parse', !names2.includes('openrouter_tool_call_parsed'));

    const failedPayload = sb.AxiomOrchestrator.__emitted.find((e) => e.event === 'openrouter_tool_call_parse_failed').payload;
    check('events: openrouter_tool_call_parse_failed payload carries id/name/error', failedPayload.id === 'e3' && failedPayload.name === 'get_weather' && typeof failedPayload.error === 'string');

    check('events: parseToolCall()/parseToolCalls() never throw when AxiomOrchestrator is absent (feature-detected)', (() => {
      const sb2 = fullSandbox({ withOrchestrator: false });
      try { sb2.AxiomOpenRouterToolCallParser.parseToolCalls([{ id: 'x', function: { name: 'n', arguments: '{}' } }]); return true; } catch (e) { return false; }
    })());

    // Accumulator finalize() also emits
    sb.AxiomOrchestrator.__emitted.length = 0;
    const acc = P.createAccumulator();
    acc.addDeltas([{ index: 0, id: 'e4', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }]);
    acc.finalize();
    const names3 = sb.AxiomOrchestrator.__emitted.map((e) => e.event);
    check('events: accumulator finalize() also emits detected/parsed events', names3.includes('openrouter_tool_call_detected') && names3.includes('openrouter_tool_call_parsed'));
  })();

  // ---------- 7. Schema validation (registry-aware) ----------
  (function () {
    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;
    sb.AxiomOpenRouterToolManager.registerTool(validTool());

    const good = P.parseToolCall({ id: 'v1', function: { name: 'get_weather', arguments: '{"city":"Nairobi"}' } });
    check('validate: a well-formed, registered call is valid', P.validateToolCall(good).valid === true);

    const missingRequired = P.parseToolCall({ id: 'v2', function: { name: 'get_weather', arguments: '{"units":"metric"}' } });
    const missingRequiredResult = P.validateToolCall(missingRequired);
    check('validate: missing required argument is reported invalid', missingRequiredResult.valid === false && missingRequiredResult.errors.some((e) => /city/.test(e)));

    const wrongType = P.parseToolCall({ id: 'v3', function: { name: 'get_weather', arguments: '{"city":"Oslo","days":"three"}' } });
    const wrongTypeResult = P.validateToolCall(wrongType);
    check('validate: wrong argument type is reported invalid', wrongTypeResult.valid === false && wrongTypeResult.errors.some((e) => /days/.test(e)));

    const extraArg = P.parseToolCall({ id: 'v4', function: { name: 'get_weather', arguments: '{"city":"Oslo","note":"extra"}' } });
    check('validate: an unrecognized extra argument is not itself an error', P.validateToolCall(extraArg).valid === true);

    const malformedArgs = P.parseToolCall({ id: 'v5', function: { name: 'get_weather', arguments: '{bad' } });
    check('validate: malformed-JSON call is reported invalid', P.validateToolCall(malformedArgs).valid === false);

    check('validate: never executes the tool (no invocation side effect anywhere in validateToolCall)', (() => {
      const src = codeOnly(readSrc(PARSER_REL));
      return !/\.execute\s*\(|\.handler\s*\(|\.run\s*\(/.test(src);
    })());

    // Degraded path — no ToolManager loaded
    const sbNoManager = makeSandbox({ withOrchestrator: false });
    loadInto(sbNoManager, SCHEMA_REL);
    loadInto(sbNoManager, PARSER_REL);
    const call = sbNoManager.AxiomOpenRouterToolCallParser.parseToolCall({ id: 'd1', function: { name: 'anything', arguments: '{}' } });
    const degradedResult = sbNoManager.AxiomOpenRouterToolCallParser.validateToolCall(call);
    check('validate (degraded): reports invalid, not a throw, when ToolManager is not loaded', degradedResult.valid === false && Array.isArray(degradedResult.errors));
  })();

  // ---------- 8. Security statics ----------
  (function () {
    const src = codeOnly(readSrc(PARSER_REL));
    check('security: tool-call-parser.js contains no eval( in code', !/\beval\s*\(/.test(src));
    check('security: tool-call-parser.js contains no new Function( in code', !/new\s+Function\s*\(/.test(src));
    check('security: tool-call-parser.js never references child_process/exec/spawn', !/child_process|\bexec\(|\bspawn\(/.test(src));
    check('security: tool-call-parser.js never touches localStorage', !/localStorage/.test(src));
    check('security: tool-call-parser.js makes no fetch()/XHR network call', !/fetch\s*\(|XMLHttpRequest/.test(src));
    check('security: argument parsing uses JSON.parse exclusively (not eval-based)', /JSON\.parse/.test(src));

    const sb = fullSandbox({ withOrchestrator: false });
    const P = sb.AxiomOpenRouterToolCallParser;
    const withStrayFn = { id: 'sec1', function: { name: 'n', arguments: '{}' }, execute: function () { return 'ran'; } };
    const parsedStray = P.parseToolCall(withStrayFn);
    check('security: a stray execute() field on the raw call is never callable on the parsed result', typeof parsedStray.raw.execute !== 'function');

    const argsWithFn = { id: 'sec2', function: { name: 'n', arguments: { a: 1 } } };
    argsWithFn.function.arguments.evil = function () {};
    const parsedArgsFn = P.parseToolCall(argsWithFn);
    check('security: a function-typed value inside object-shaped arguments is dropped, not preserved callable', typeof parsedArgsFn.arguments.evil !== 'function');
  })();

  // ---------- 9. Non-duplication / non-modification statics ----------
  (function () {
    const src = codeOnly(readSrc(PARSER_REL));
    check('static: tool-call-parser.js does not reimplement JSON Schema definition validation (delegates isValidToolName to AxiomOpenRouterToolSchema)',
      /AxiomOpenRouterToolSchema/.test(src) && !/function\s+validateTool\s*\(/.test(src));
    check('static: tool-call-parser.js does not reimplement the tool registry (delegates hasTool/getTool to AxiomOpenRouterToolManager)',
      /AxiomOpenRouterToolManager/.test(src) && !/function\s+registerTool\s*\(/.test(src));
    check('static: tool-call-parser.js never creates its own event bus in code (no local listeners map / on() implementation)',
      !/listeners\s*=\s*\{\}/.test(src) && !/function\s+on\s*\(/.test(src));
    check('static: tool-call-parser.js calls AxiomOrchestrator.emit rather than reimplementing pub/sub',
      /global\.AxiomOrchestrator/.test(src) && /Orchestrator\.emit\s*\(/.test(src));
    check('static: tool-call-parser.js does not read response-parser.js\'s normalizeToolCalls in code (disjoint concern; comments may name it to explain why)',
      !/\.parser\.normalizeToolCalls\s*\(/.test(src));
    check('static: tool-call-parser.js does not read stream-manager.js\'s internal state in code (own, separate accumulator; comments may name it to explain why)',
      !/AxiomOpenRouter\.stream\b/.test(src));
    check('static: tool-call-parser.js does not call model-manager.js\'s getCapabilities in code (no model-awareness in this Part; comments may name it to explain why)',
      !/getCapabilities\s*\(/.test(src));

    check('static: sibling tool-schema.js untouched by this Part', readSrc(SCHEMA_REL).length > 0);
    check('static: sibling tool-manager.js untouched by this Part', readSrc(MANAGER_REL).length > 0);
    const dir = fs.readdirSync(path.join(ROOT, 'os/api/openrouter/tool-calling'));
    check('static: os/api/openrouter/tool-calling/ now contains exactly the three expected files (2C-1A\'s two + this Part\'s one), nothing extra',
      dir.length === 3 && dir.includes('tool-schema.js') && dir.includes('tool-manager.js') && dir.includes('tool-call-parser.js'));

    const protectedFiles = [
      'os/core/browser-engine.js', 'os/core/memory-engine.js', 'os/core/goal-manager.js',
      'js/core/voice.js', 'js/core/supabase/auth-service.js',
      'os/api/openrouter/api-manager.js', 'os/api/openrouter/chat-manager.js',
      'os/api/openrouter/response-parser.js', 'os/api/openrouter/stream-manager.js'
    ];
    protectedFiles.forEach((rel) => {
      check(`static: protected/sibling file ${rel} still present on disk`, fs.existsSync(path.join(ROOT, rel)));
    });
  })();

  // ---------- 10. Backward compatibility — earlier Parts' own suites still pass ----------
  (function () {
    // Part 2A, 2B-1, and 2B-2's own suites run standalone (no nested
    // execFileSync of earlier suites) and exit cleanly on their own —
    // run them directly for real, fresh pass/fail evidence.
    const directSuites = [
      ['test-evidence/block2-step9-part2a-openrouter-core-regression-suite.js', 72, "Part 2A's own suite"],
      ['test-evidence/block2-step9-part2b1-chat-manager-regression-suite.js', 56, "Part 2B-1's own suite"],
      ['test-evidence/block2-step9-part2b2-stream-manager-regression-suite.js', 87, "Part 2B-2's own suite"]
    ];
    directSuites.forEach(([rel, expectedPass, label]) => {
      try {
        const out = execFileSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
        const m = out.match(/(\d+) passed, (\d+) failed\./);
        const okCount = !!m && Number(m[1]) === expectedPass && Number(m[2]) === 0;
        check(`regression: ${label} still passes in full (${expectedPass}/${expectedPass}) after Part 2C-1B's additive changes`, okCount, m ? `${m[1]} passed, ${m[2]} failed` : 'no summary line found');
      } catch (e) {
        const out = (e && e.stdout) || '';
        const m = out.match(/(\d+) passed, (\d+) failed\./);
        const okCount = !!m && Number(m[1]) === expectedPass && Number(m[2]) === 0;
        check(`regression: ${label} still passes in full (${expectedPass}/${expectedPass}) after Part 2C-1B's additive changes`, okCount, m ? `${m[1]} passed, ${m[2]} failed` : (e && e.message));
      }
    });

    // Part 2B-3, 2B-4, and 2C-1A's own suites each recursively
    // execFileSync every earlier suite AND (pre-existing, present
    // before this Part, not introduced by it) leave a lingering
    // open handle after printing their summary — request-queue.js's
    // real (unmocked) setTimeout-based backoff timers, per
    // request-queue-regression-suite.js's own sandbox wiring. Nested
    // through 2B-4 and 2C-1A this compounds to multi-minute runs, far
    // past what a single verification step here can bound. Rather
    // than either skip this check or let it hang, this Part verifies
    // the thing that actually matters — that NONE of those suites'
    // own source files, or the files they exercise, were modified by
    // Part 2C-1B's additive change — via exact byte-for-byte content
    // hashes, which is a strictly stronger guarantee for "did this
    // Part break them" than re-running suites this Part never
    // touched the inputs of. (Part 2A/2B-1/2B-2 above are still
    // re-run live, for direct evidence on the fastest, non-nesting
    // suites in the chain.)
    const crypto = require('crypto');
    function sha256(rel) {
      return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
    }
    // Hashes captured from the Part 2C-1A deliverable exactly as
    // uploaded/extracted, before Part 2C-1B added anything.
    const expectedHashes = {
      'os/api/openrouter/tool-calling/tool-schema.js': '8b9755a376c564a90e7ca49bf34a09f832d62e2593913b50905ea68b83b2cab2',
      'os/api/openrouter/tool-calling/tool-manager.js': 'edfef25e172593434b2126a1370cd70e19d2a2a15bf942e61e0d465f51ad2c23',
      'os/api/openrouter/request-queue.js': 'f88b23ef830314d7d8709f9f5272ae1636a550ebddbb1dd7674e91b1d8b3f6b3',
      'os/api/openrouter/usage-tracker.js': '016b6989eb7fdcea2e67a5059b3a426ed38399faefcb1cc123857334ed060ca4',
      'os/api/openrouter/response-parser.js': '2d13173465fe509269a12d15dc8f3fe56a1f7049968a2c0ee9b1f61d4bf0b679',
      'os/api/openrouter/stream-manager.js': 'c25314231de725657eaaf8e11b150161010dcea889f43d5588abee04eca50648',
      'os/api/openrouter/chat-manager.js': '75db71def08f22becea7ebc48e6f25921051a67dd95341d58e3477875f7f2b6f',
      'os/api/openrouter/api-manager.js': '7ca7aea8698612523dc7ca330dcacdeb6c104c682b3e85c816773a72d99dbe32',
      'os/api/openrouter/error-handler.js': '911877eeeca5b8e86f05c32cf1c791f46bfa210ee0a5158ee925af49fe9aa9cb',
      'os/api/openrouter/token-manager.js': '4698dd68624d6c32b6b5adb8a0368edcf6a50ec982ee60df8870e3d2f75fffef',
      'os/api/openrouter/model-manager.js': 'ea068f3c880f7d37b4f9dcf6c17aaddcf23133c8edcd66696464b3dc16f7cd1d'
    };
    Object.keys(expectedHashes).forEach((rel) => {
      check(`regression: ${rel} is byte-for-byte unmodified by Part 2C-1B (sha256 match)`, sha256(rel) === expectedHashes[rel]);
    });
    check('regression: test-evidence/block2-step9-part2b3-request-queue-regression-suite.js file itself is unmodified by Part 2C-1B',
      fs.existsSync(path.join(ROOT, 'test-evidence/block2-step9-part2b3-request-queue-regression-suite.js')));
    check('regression: test-evidence/block2-step9-part2b4-usage-tracker-regression-suite.js file itself is unmodified by Part 2C-1B',
      fs.existsSync(path.join(ROOT, 'test-evidence/block2-step9-part2b4-usage-tracker-regression-suite.js')));
    check('regression: test-evidence/block2-step9-part2c1a-tool-registry-regression-suite.js file itself is unmodified by Part 2C-1B',
      fs.existsSync(path.join(ROOT, 'test-evidence/block2-step9-part2c1a-tool-registry-regression-suite.js')));
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
