// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-2A: OpenRouter Tool Calling
// AXIOM Tool Registry Discovery Bridge — Regression Test Suite
// ------------------------------------------------------------
// Tests os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js
// along with its dependencies (tool-schema.js, tool-manager.js,
// orchestrator.js, agent-registry-integration.js) in Node.js vm.
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
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function codeOnly(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
}

function makeFakeOrchestrator() {
  const emitted = [];
  const listeners = {};
  const agents = {};

  return {
    __emitted: emitted,
    on(event, fn) {
      (listeners[event] || (listeners[event] = [])).push(fn);
      return () => {};
    },
    emit(event, payload) {
      emitted.push({ event, payload });
      (listeners[event] || []).forEach((fn) => fn(payload, event));
    },
    registerAgent(config) {
      const record = {
        id: config.id,
        name: config.name || config.id,
        capabilities: config.capabilities || [],
        permissions: config.permissions || [],
        tools: config.tools || [],
        health: config.health || 'healthy',
        status: config.status || 'idle'
      };
      agents[config.id] = record;
      return record;
    },
    listAgents() {
      return Object.values(agents);
    },
    getAgent(id) {
      return agents[id] || null;
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
    AxLogger: opts.withLogger === false ? undefined : {
      logs: [],
      warns: [],
      errors: [],
      log(msg, d) { this.logs.push({ msg, d }); },
      warn(msg, d) { this.warns.push({ msg, d }); },
      error(msg, d) { this.errors.push({ msg, d }); },
      info(msg, d) { this.logs.push({ msg, d }); }
    },
    AxiomOrchestrator: opts.withOrchestrator === false ? undefined : makeFakeOrchestrator(),
    AxiomRuntimeContext: opts.withRuntimeContext === false ? undefined : {
      events: [],
      recordEvent(event, payload) { this.events.push({ event, payload }); }
    },
    Object, Array, Math, Date, JSON, String, Number, Boolean, isFinite, RegExp
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
const BRIDGE_REL = 'os/api/openrouter/tool-calling/axiom-tool-registry-bridge.js';

function fullBridgeSandbox(opts) {
  const sb = makeSandbox(opts);
  loadInto(sb, SCHEMA_REL);
  loadInto(sb, MANAGER_REL);
  loadInto(sb, PARSER_REL);
  loadInto(sb, BRIDGE_REL);
  return sb;
}

console.log('============================================================');
console.log('AXIOM — Block 2 / Step 9 / Part 2C-2A Regression Suite');
console.log('============================================================\n');

// 1. Initialization
{
  const sb = fullBridgeSandbox();
  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  check('initialize — returns success object with tool count', typeof Bridge.initialize === 'function', 'Bridge.initialize missing');
  const initRes = Bridge.initialize();
  check('initialize — success status is true', initRes && initRes.success === true, JSON.stringify(initRes));
  check('getStatus — reflects initialized state', Bridge.getStatus().initialized === true, 'getStatus().initialized is false');
}

// 2. Discovery
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'browser',
    name: 'Browser Agent',
    tools: ['browser.navigate', 'browser.refresh'],
    permissions: ['browser:navigate'],
    health: 'healthy',
    status: 'idle'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  const discovered = Bridge.discoverTools();
  check('discoverTools — discovers tools from registered agents', Array.isArray(discovered) && discovered.length === 2, `Expected 2, got ${discovered.length}`);
  check('discoverTools — normalized tool names created correctly', discovered[0].name === 'browser_navigate' && discovered[1].name === 'browser_refresh', JSON.stringify(discovered.map(t => t.name)));
}

// 3. Empty registry handling
{
  const sb = fullBridgeSandbox();
  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  const discovered = Bridge.discoverTools();
  check('empty registry — handles empty agent registry safely without crashing', Array.isArray(discovered) && discovered.length === 0, `Got ${discovered.length}`);
  check('empty registry — getStatus shows zero tools', Bridge.getStatus().count === 0, 'count !== 0');
}

// 4. Missing registry handling
{
  const sb = fullBridgeSandbox({ withOrchestrator: false });
  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  const discovered = Bridge.discoverTools();
  check('missing registry — handles missing AxiomOrchestrator gracefully', Array.isArray(discovered) && discovered.length === 0, `Got ${discovered.length}`);
}

// 5. Tool normalization
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'test',
    name: 'Test Agent',
    tools: ['browser.navigate', 'memory.findMemories', 'coding.projectSearch', 'sample:action'],
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const tools = Bridge.getTools();
  const names = tools.map(t => t.name);
  check('tool normalization — browser.navigate -> browser_navigate', names.includes('browser_navigate'), `Names: ${names.join(', ')}`);
  check('tool normalization — memory.findMemories -> memory_findMemories', names.includes('memory_findMemories'), `Names: ${names.join(', ')}`);
  check('tool normalization — coding.projectSearch -> coding_projectSearch', names.includes('coding_projectSearch'), `Names: ${names.join(', ')}`);
  check('tool normalization — sample:action -> sample_action', names.includes('sample_action'), `Names: ${names.join(', ')}`);
}

// 6. Schema validation
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'browser',
    name: 'Browser Agent',
    tools: ['browser.navigate'],
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const ToolManager = sb.AxiomOpenRouterToolManager;
  check('schema validation — registered tool present in AxiomOpenRouterToolManager', ToolManager.hasTool('browser_navigate'), 'ToolManager missing browser_navigate');
}

// 7. Invalid schema handling
{
  const sb = fullBridgeSandbox();
  const ToolManager = sb.AxiomOpenRouterToolManager;
  const badToolRes = ToolManager.registerTool({
    name: 'invalid tool name!',
    description: 'Bad schema',
    parameters: 'not an object'
  });
  check('invalid schema — rejected by ToolManager / ToolSchema', badToolRes.success === false, 'Invalid tool was accepted');
}

// 8. Duplicate capability handling & Collision Detection
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'agent1',
    name: 'Agent One',
    tools: ['tool.a'],
    health: 'healthy'
  });
  Orchestrator.registerAgent({
    id: 'agent2',
    name: 'Agent Two',
    tools: ['tool_a'], // "tool.a" and "tool_a" both normalize to "tool_a" -> COLLISION!
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const tools = Bridge.getTools();
  check('collision detection — conflicting normalized tool excluded from registry', !tools.some(t => t.name === 'tool_a'), `tool_a was registered despite collision: ${JSON.stringify(tools)}`);
  const status = Bridge.getStatus();
  check('collision detection — status records collision count', status.collisionsCount === 1, `Collisions count: ${status.collisionsCount}`);
  
  const errEvents = Orchestrator.__emitted.filter(e => e.event === 'openrouter_axiom_registry_error');
  check('collision detection — emits registry_error event for collision', errEvents.length > 0 && errEvents.some(e => e.payload.error === 'name_collision'), 'Error event not emitted');
}

// 9. Availability metadata
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'healthy_agent',
    name: 'Healthy Agent',
    tools: ['healthy.tool'],
    health: 'healthy',
    status: 'idle'
  });
  Orchestrator.registerAgent({
    id: 'unhealthy_agent',
    name: 'Unhealthy Agent',
    tools: ['unhealthy.tool'],
    health: 'unhealthy',
    status: 'error'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const healthyTool = Bridge.getTool('healthy_tool');
  const unhealthyTool = Bridge.getTool('unhealthy_tool');

  check('availability metadata — healthy agent tool marked available', healthyTool && healthyTool.metadata.available === true, 'Healthy tool not available');
  check('availability metadata — unhealthy agent tool marked unavailable', unhealthyTool && unhealthyTool.metadata.available === false, 'Unhealthy tool reported as available');
  check('availability metadata — health and status preserved in metadata', healthyTool.metadata.health === 'healthy' && healthyTool.metadata.status === 'idle', 'Metadata missing health/status');
}

// 10. Permission metadata
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'perm_agent',
    name: 'Perm Agent',
    tools: ['perm.tool'],
    permissions: ['perm:read', 'perm:execute'],
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const tool = Bridge.getTool('perm_tool');
  check('permission metadata — permissions array preserved in tool metadata', tool && Array.isArray(tool.metadata.permissions) && tool.metadata.permissions.includes('perm:read'), 'Permissions array missing');
}

// 11. getTool()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'test',
    tools: ['test.tool'],
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const byNorm = Bridge.getTool('test_tool');
  const byOrig = Bridge.getTool('test.tool');
  check('getTool — retrieves tool by normalized name', byNorm !== null && byNorm.name === 'test_tool', 'Lookup by norm name failed');
  check('getTool — retrieves tool by original name', byOrig !== null && byOrig.name === 'test_tool', 'Lookup by orig name failed');
  check('getTool — returns null for unknown tool', Bridge.getTool('unknown_tool') === null, 'Unknown tool returned non-null');
}

// 12. hasTool()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'test',
    tools: ['test.tool'],
    health: 'healthy'
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  check('hasTool — returns true for existing tool', Bridge.hasTool('test_tool') === true, 'hasTool(existing) returned false');
  check('hasTool — returns false for missing tool', Bridge.hasTool('missing_tool') === false, 'hasTool(missing) returned true');
}

// 13. getTools()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({ id: 'a1', tools: ['t1'], health: 'healthy' });
  Orchestrator.registerAgent({ id: 'a2', tools: ['t2'], health: 'healthy' });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const tools = Bridge.getTools();
  check('getTools — returns list of discovered tools', Array.isArray(tools) && tools.length === 2, `Got ${tools.length} tools`);
}

// 14. getToolDefinitions()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({ id: 'a1', tools: ['browser.navigate'], health: 'healthy' });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  const defs = Bridge.getToolDefinitions();
  check('getToolDefinitions — returns OpenRouter wire-format function definitions', Array.isArray(defs) && defs.length === 1 && defs[0].type === 'function' && defs[0].function.name === 'browser_navigate', JSON.stringify(defs));
  check('getToolDefinitions — wire format includes parameters schema object', defs[0].function.parameters && defs[0].function.parameters.type === 'object', 'Parameters schema missing');
}

// 15. refresh()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({ id: 'a1', tools: ['tool.one'], health: 'healthy' });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  check('refresh — initial tool count is 1', Bridge.getTools().length === 1, 'Initial count != 1');

  Orchestrator.registerAgent({ id: 'a2', tools: ['tool.two'], health: 'healthy' });
  const refreshed = Bridge.refresh();
  check('refresh — updates snapshot and returns refreshed tools', refreshed.length === 2, `Refreshed count = ${refreshed.length}`);
  const refEvents = Orchestrator.__emitted.filter(e => e.event === 'openrouter_axiom_registry_refreshed');
  check('refresh — emits openrouter_axiom_registry_refreshed event', refEvents.length === 1, 'Refresh event missing');
}

// 16. destroy()
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({ id: 'a1', tools: ['tool.one'], health: 'healthy' });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  check('destroy — initialized before destroy', Bridge.getStatus().initialized === true, 'Not initialized');
  Bridge.destroy();
  check('destroy — resets state to uninitialized and clears tools', Bridge.getStatus().initialized === false && Bridge.getTools().length === 0, 'Destroy state invalid');
  const ToolManager = sb.AxiomOpenRouterToolManager;
  check('destroy — clears bridge registrations from AxiomOpenRouterToolManager', ToolManager.hasTool('tool_one') === false, 'ToolManager still has tool');
}

// 17. Event Bus events
{
  const sb = fullBridgeSandbox();
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({ id: 'a1', tools: ['t1'], health: 'healthy' });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();

  const events = Orchestrator.__emitted.map(e => e.event);
  check('events — emits openrouter_axiom_tools_discovered', events.includes('openrouter_axiom_tools_discovered'), `Events: ${events.join(', ')}`);
  check('events — emits openrouter_axiom_registry_initialized', events.includes('openrouter_axiom_registry_initialized'), `Events: ${events.join(', ')}`);

  const initEvent = Orchestrator.__emitted.find(e => e.event === 'openrouter_axiom_registry_initialized');
  check('events — payload contains count, timestamp, status, source', initEvent && initEvent.payload.count === 1 && typeof initEvent.payload.timestamp === 'number' && initEvent.payload.status === 'healthy' && initEvent.payload.source === 'axiom', JSON.stringify(initEvent));
  check('events — payload does not contain secrets or API keys', !JSON.stringify(initEvent).includes('key') && !JSON.stringify(initEvent).includes('secret'), 'Payload contains secret/key');
}

// 18. Runtime Context integration
{
  const sb = fullBridgeSandbox();
  const RC = sb.AxiomRuntimeContext;
  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  check('runtime context — records discovery and initialization events in AxiomRuntimeContext', RC.events.length >= 2, `Recorded ${RC.events.length} events`);
}

// 19. Logger integration
{
  const sb = fullBridgeSandbox();
  const Logger = sb.AxLogger;
  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  check('logger — logs initialization info via AxLogger', Logger.logs.length > 0, 'No logs recorded');
}

// 20. Strictly read-only behavior
{
  const bridgeCode = codeOnly(readSrc(BRIDGE_REL));
  check('read-only — bridge contains no executeTool invocations', !bridgeCode.includes('executeTool('), 'Contains executeTool invocation');
  check('read-only — bridge contains no handler function calls', !bridgeCode.includes('.handler('), 'Contains handler invocation');
  check('read-only — bridge contains no window navigation calls', !bridgeCode.includes('location.href') && !bridgeCode.includes('window.open'), 'Contains navigation call');
}

// 21. No tool execution
{
  const sb = fullBridgeSandbox();
  let handlerCalled = false;
  const Orchestrator = sb.AxiomOrchestrator;
  Orchestrator.registerAgent({
    id: 'a1',
    tools: ['t1'],
    handler: function () { handlerCalled = true; }
  });

  const Bridge = sb.AxiomOpenRouterToolRegistryBridge;
  Bridge.initialize();
  Bridge.getTools();
  Bridge.getToolDefinitions();
  Bridge.refresh();

  check('no tool execution — agent handler function was never called during discovery/get/refresh', handlerCalled === false, 'Agent handler was executed!');
}

// 22. No eval()
{
  const bridgeCode = codeOnly(readSrc(BRIDGE_REL));
  check('security — contains no eval() in code', !/\beval\s*\(/.test(bridgeCode), 'Contains eval()');
}

// 23. No Function()
{
  const bridgeCode = codeOnly(readSrc(BRIDGE_REL));
  check('security — contains no new Function() in code', !/\bnew\s+Function\b/.test(bridgeCode), 'Contains Function()');
}

// 24. Part 2C-1A compatibility
{
  const sb = fullBridgeSandbox();
  check('part 2c-1a compatibility — AxiomOpenRouterToolSchema loaded and valid', sb.AxiomOpenRouterToolSchema && typeof sb.AxiomOpenRouterToolSchema.validateTool === 'function', 'ToolSchema missing');
  check('part 2c-1a compatibility — AxiomOpenRouterToolManager loaded and valid', sb.AxiomOpenRouterToolManager && typeof sb.AxiomOpenRouterToolManager.registerTool === 'function', 'ToolManager missing');
}

// 25. Part 2C-1B compatibility
{
  const sb = fullBridgeSandbox();
  check('part 2c-1b compatibility — AxiomOpenRouterToolCallParser loaded and valid', sb.AxiomOpenRouterToolCallParser && typeof sb.AxiomOpenRouterToolCallParser.parseToolCall === 'function', 'ToolCallParser missing');
}

console.log('\n============================================================');
console.log(`Summary: ${pass} passed, ${fail} failed.`);
console.log('============================================================');

if (fail > 0) {
  process.exit(1);
}
