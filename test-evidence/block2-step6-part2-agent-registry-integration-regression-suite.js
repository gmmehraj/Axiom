// ============================================================
// AXIOM — Block 2 / Step 6 / Part 2: Agent Registry Integration
// regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1) plus
// the real, unmodified os/core/agent-registry-integration.js (Part 2)
// in a minimal vm sandbox (same pattern as the Part 1 suite), with
// small mock stand-ins for AxiomBrowserManager / AxiomBrain /
// AxiomMemoryManager / AxiomAutomationManager / AxiomAnalyticsAutomation
// standing in for the real subsystem files (which are exercised by
// their own dedicated foundation suites elsewhere in test-evidence/).
// This suite's job is only to prove the *registration* contract:
// every subsystem present on the page ends up correctly registered,
// with accurate capabilities/tools/health, and that the discovery
// APIs and health sync work against real registry state.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function mockBrowserManager(healthStatus) {
  return {
    navigate: async (url) => ({ ok: true, url }),
    back: async () => ({ ok: true }),
    forward: async () => ({ ok: true }),
    refresh: async () => ({ ok: true }),
    createSession: async () => ({ session: { id: 's1' } }),
    createTab: async () => ({ tab: { id: 't1' } }),
    readHistory: async () => ({ pages: [] }),
    diagnostics: async () => ({ ok: true }),
    executeBrowserOp: async (op) => ({ ok: true, op }),
    health: () => ({ status: healthStatus || 'healthy', checks: {}, timestamp: Date.now() })
  };
}

function mockBrain() {
  return {
    getState: () => ({ activity: 'idle', mood: 'neutral' }),
    setState: (s) => s,
    dayCount: () => 3,
    timeOfDay: () => 'morning'
  };
}

function mockMemoryManager() {
  return {
    getConversation: async () => ({ id: 'c1' }),
    listConversations: async () => [],
    findMemories: async () => [],
    registerMemory: async (m) => m,
    getOverview: () => ({ stats: {}, topTags: [] }),
    runCleanup: async () => ({ changed: 0 })
  };
}

function mockAutomationManager() {
  return {
    workflows: {},
    queue: {},
    run: async () => ({ ok: true }),
    status: { getStatus: () => ({ queue: [], engine: {} }) },
    history: {},
    getStats: () => ({ completed: 0, failed: 0 })
  };
}

function mockAnalyticsAutomation() {
  return {
    state: { logs: [] },
    enhanceAnalytics: () => true,
    enhanceAutomation: () => true,
    addLog: (l) => l
  };
}

function loadSandbox(opts) {
  opts = opts || {};
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined; // no DOM branch, same as Part 1 suite

  if (opts.browser !== false) sandbox.window.AxiomBrowserManager = mockBrowserManager(opts.browserHealth);
  if (opts.brain !== false) sandbox.window.AxiomBrain = mockBrain();
  if (opts.memory !== false) sandbox.window.AxiomMemoryManager = mockMemoryManager();
  if (opts.automation !== false) sandbox.window.AxiomAutomationManager = mockAutomationManager();
  if (opts.analytics !== false) sandbox.window.AxiomAnalyticsAutomation = mockAnalyticsAutomation();

  vm.createContext(sandbox);

  const orchestratorSrc = fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8');
  vm.runInContext(orchestratorSrc, sandbox, { filename: 'orchestrator.js' });

  const integrationSrc = fs.readFileSync(path.join(AI, 'os/core/agent-registry-integration.js'), 'utf8');
  vm.runInContext(integrationSrc, sandbox, { filename: 'agent-registry-integration.js' });

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + e.message);
  }
}

async function main() {
  console.log('AXIOM Block 2 / Step 6 / Part 2 — Agent Registry Integration regression\n');

  await test('module loads and requires AxiomOrchestrator to be present first', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/agent-registry-integration.js'), 'utf8');
    // Should not throw even with no AxiomOrchestrator present — it logs and returns.
    vm.runInContext(src, sandbox, { filename: 'agent-registry-integration.js' });
    assert.strictEqual(sandbox.window.AxiomAgentRegistryIntegration, undefined);
  });

  await test('auto-registration on load registers every present subsystem', async () => {
    const W = loadSandbox({});
    await tick(10);
    const ids = W.AxiomOrchestrator.listAgents().map((a) => a.id).sort();
    assert.deepStrictEqual(ids, ['analytics', 'automation', 'brain', 'browser', 'memory', 'system']);
  });

  await test('missing subsystem globals are skipped, not fabricated', async () => {
    const W = loadSandbox({ browser: false, analytics: false });
    await tick(10);
    const ids = W.AxiomOrchestrator.listAgents().map((a) => a.id).sort();
    assert.deepStrictEqual(ids, ['automation', 'brain', 'memory', 'system']);
    assert.strictEqual(W.AxiomOrchestrator.getAgent('browser'), null);
  });

  await test('Browser Agent is registered with real tools/capabilities and healthy status', async () => {
    const W = loadSandbox({});
    await tick(10);
    const agent = W.AxiomOrchestrator.getAgent('browser');
    assert.ok(agent);
    assert.ok(agent.capabilities.indexOf('navigate') !== -1);
    assert.ok(agent.tools.length > 0);
    assert.strictEqual(agent.health, 'healthy');
  });

  await test('a degraded subsystem health() maps to a degraded registry health at registration time', async () => {
    const W = loadSandbox({ browserHealth: 'degraded' });
    await tick(10);
    assert.strictEqual(W.AxiomOrchestrator.getAgent('browser').health, 'degraded');
  });

  await test('an unavailable subsystem health() maps to unhealthy', async () => {
    const W = loadSandbox({ browserHealth: 'unavailable' });
    await tick(10);
    assert.strictEqual(W.AxiomOrchestrator.getAgent('browser').health, 'unhealthy');
  });

  await test('registration is idempotent — calling registerAll() again does not throw or duplicate', async () => {
    const W = loadSandbox({});
    await tick(10);
    const before = W.AxiomOrchestrator.listAgents().length;
    assert.doesNotThrow(() => W.AxiomAgentRegistryIntegration.registerAll());
    assert.strictEqual(W.AxiomOrchestrator.listAgents().length, before);
  });

  await test('registered handlers are never invoked by registration itself (no execution-flow change)', async () => {
    let navigateCalled = false;
    const sandbox = loadSandboxWithSpy();
    await tick(10);
    assert.strictEqual(navigateCalled, false);

    function loadSandboxWithSpy() {
      const s = {
        console, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Promise, Object, Array, JSON, Math, Error
      };
      s.window = s;
      s.document = undefined;
      const bm = mockBrowserManager();
      const realNavigate = bm.navigate;
      bm.navigate = async (...args) => { navigateCalled = true; return realNavigate(...args); };
      s.window.AxiomBrowserManager = bm;
      vm.createContext(s);
      vm.runInContext(fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8'), s, { filename: 'orchestrator.js' });
      vm.runInContext(fs.readFileSync(path.join(AI, 'os/core/agent-registry-integration.js'), 'utf8'), s, { filename: 'agent-registry-integration.js' });
      return s.window;
    }
  });

  await test('a registered handler forwards a real dispatch() to the underlying subsystem (dormant, not auto-run)', async () => {
    const W = loadSandbox({});
    await tick(10);
    const id = W.AxiomOrchestrator.dispatch({ agentId: 'browser', type: 'navigate', payload: { url: 'https://example.com' } });
    await tick(50);
    const task = W.AxiomOrchestrator.getTask(id);
    assert.strictEqual(task.status, 'completed');
    assert.strictEqual(task.result.url, 'https://example.com');
  });

  await test('discoverAgents() supports capability/health/status filters', async () => {
    const W = loadSandbox({});
    await tick(10);
    const withNavigate = W.AxiomOrchestrator.discoverAgents({ capability: 'navigate' });
    assert.deepStrictEqual(withNavigate.map((a) => a.id), ['browser']);
    const allHealthy = W.AxiomOrchestrator.discoverAgents({ health: 'healthy' });
    assert.strictEqual(allHealthy.length, 6);
  });

  await test('discoverCapabilities() returns a deduplicated, sorted list across all agents', async () => {
    const W = loadSandbox({});
    await tick(10);
    const caps = W.AxiomOrchestrator.discoverCapabilities();
    assert.ok(caps.indexOf('navigate') !== -1);
    assert.ok(caps.indexOf('workflow-execution') !== -1);
    assert.deepStrictEqual(caps, Array.from(new Set(caps)).sort());
  });

  await test('findAgentByCapability() matches the same agents as discoverAgents({capability})', async () => {
    const W = loadSandbox({});
    await tick(10);
    const a = W.AxiomOrchestrator.findAgentByCapability('memory-storage').map((x) => x.id);
    assert.deepStrictEqual(a, ['memory']);
  });

  await test('getAgentHealth() returns a focused snapshot, null for unknown id', async () => {
    const W = loadSandbox({});
    await tick(10);
    const h = W.AxiomOrchestrator.getAgentHealth('brain');
    assert.strictEqual(h.id, 'brain');
    assert.strictEqual(h.health, 'healthy');
    assert.strictEqual(W.AxiomOrchestrator.getAgentHealth('nope'), null);
  });

  await test('getSystemHealth() aggregates counts and overall status correctly', async () => {
    const W = loadSandbox({ browserHealth: 'degraded' });
    await tick(10);
    const sys = W.AxiomOrchestrator.getSystemHealth();
    assert.strictEqual(sys.totalAgents, 6);
    assert.strictEqual(sys.degraded, 1);
    assert.strictEqual(sys.healthy, 5);
    assert.strictEqual(sys.overall, 'degraded');
  });

  await test('listAvailableTools() maps every tool to its owning agent, deduplicated', async () => {
    const W = loadSandbox({});
    await tick(10);
    const tools = W.AxiomOrchestrator.listAvailableTools();
    const memoryTool = tools.find((t) => t.tool === 'memory.getOverview');
    assert.ok(memoryTool);
    assert.strictEqual(memoryTool.agentId, 'memory');
    const unique = new Set(tools.map((t) => t.tool));
    assert.strictEqual(unique.size, tools.length);
  });

  await test('syncHealth() re-probes and updates health after a subsystem degrades post-registration', async () => {
    const W = loadSandbox({});
    await tick(10);
    assert.strictEqual(W.AxiomOrchestrator.getAgent('browser').health, 'healthy');
    W.AxiomBrowserManager.health = () => ({ status: 'unavailable' });
    W.AxiomAgentRegistryIntegration.syncHealth();
    assert.strictEqual(W.AxiomOrchestrator.getAgent('browser').health, 'unhealthy');
  });

  await test('discovery API additions never expose the raw handler function', async () => {
    const W = loadSandbox({});
    await tick(10);
    W.AxiomOrchestrator.discoverAgents().forEach((a) => {
      assert.strictEqual(a.handler, undefined);
    });
  });

  await test('Part 1 Orchestrator behavior is completely unmodified: manual registerAgent() still works', async () => {
    const W = loadSandbox({});
    await tick(10);
    const custom = W.AxiomOrchestrator.registerAgent({ id: 'custom', handler: async () => 'ok' });
    assert.strictEqual(custom.id, 'custom');
    assert.strictEqual(W.AxiomOrchestrator.listAgents().length, 7);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passing');
  if (failed > 0) process.exitCode = 1;
}

main();
