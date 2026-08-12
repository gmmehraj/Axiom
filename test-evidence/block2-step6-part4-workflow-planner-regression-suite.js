// ============================================================
// AXIOM — Block 2 / Step 6 / Part 4: Multi-Agent Collaboration &
// Workflow Orchestration regression suite
// ------------------------------------------------------------
// Loads the real, unmodified os/core/orchestrator.js (Part 1),
// os/core/capability-router.js (Part 3), and os/core/workflow-planner
// .js (Part 4) in a minimal vm sandbox, same pattern as the Part 3
// suite. Agents are registered directly via
// AxiomOrchestrator.registerAgent() with small handlers standing in
// for real subsystems, so this suite proves the *workflow* contract:
// multi-stage sequential collaboration, context propagation between
// stages, dependency resolution (including circular-dependency
// detection), monitoring, and failure recovery — independent of
// which real subsystems happen to be on a given page.
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const AI = path.join(__dirname, '..');

function loadSandbox(opts) {
  opts = opts || {};
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, JSON, Math, Error
  };
  sandbox.window = sandbox;
  sandbox.document = undefined;

  vm.createContext(sandbox);

  const orchestratorSrc = fs.readFileSync(path.join(AI, 'os/core/orchestrator.js'), 'utf8');
  vm.runInContext(orchestratorSrc, sandbox, { filename: 'orchestrator.js' });

  if (opts.withRouter !== false) {
    const routerSrc = fs.readFileSync(path.join(AI, 'os/core/capability-router.js'), 'utf8');
    vm.runInContext(routerSrc, sandbox, { filename: 'capability-router.js' });
  }

  if (opts.withRuntimeContext !== false) {
    const rcSrc = fs.readFileSync(path.join(AI, 'os/core/runtime-context.js'), 'utf8');
    vm.runInContext(rcSrc, sandbox, { filename: 'runtime-context.js' });
  }

  const plannerSrc = fs.readFileSync(path.join(AI, 'os/core/workflow-planner.js'), 'utf8');
  vm.runInContext(plannerSrc, sandbox, { filename: 'workflow-planner.js' });

  return sandbox.window;
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerCollabAgents(W, opts) {
  opts = opts || {};
  W.AxiomOrchestrator.registerAgent({
    id: 'executive', name: 'Executive Agent', capabilities: ['plan', 'summarize'],
    permissions: ['exec:*'], tools: [],
    handler: opts.executiveHandler || (async (task) => ({ via: 'executive', type: task.type, saw: task.payload }))
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'research', name: 'Research Agent', capabilities: ['research'],
    permissions: ['research:*'], tools: [],
    handler: opts.researchHandler || (async (task) => ({ via: 'research', findings: ['a', 'b'], of: task.payload }))
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'browser', name: 'Browser Agent', capabilities: ['browse'],
    permissions: ['browser:*'], tools: [],
    handler: opts.browserHandler || (async (task) => ({ via: 'browser', page: 'fetched', of: task.payload }))
  });
  W.AxiomOrchestrator.registerAgent({
    id: 'memory', name: 'Memory Agent', capabilities: ['memory:write'],
    permissions: ['memory:*'], tools: [],
    handler: opts.memoryHandler || (async (task) => ({ via: 'memory', stored: true, of: task.payload }))
  });
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
    console.log('        ' + e.stack);
  }
}

async function main() {
  console.log('AXIOM Block 2 / Step 6 / Part 4 — Multi-Agent Collaboration & Workflow Orchestration regression\n');

  await test('module requires AxiomOrchestrator to already be loaded', () => {
    const sandbox = { console, setTimeout, clearTimeout, Date, Object, Array, JSON, Math, Error, Promise };
    sandbox.window = sandbox;
    sandbox.document = undefined;
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(AI, 'os/core/workflow-planner.js'), 'utf8');
    assert.throws(() => vm.runInContext(src, sandbox, { filename: 'workflow-planner.js' }), /requires os\/core\/orchestrator\.js/);
  });

  await test('installs a workflow API onto the existing AxiomOrchestrator without editing Part 1/Part 3 behavior', async () => {
    const W = loadSandbox();
    assert.strictEqual(typeof W.AxiomOrchestrator.createWorkflow, 'function');
    assert.strictEqual(typeof W.AxiomOrchestrator.executeWorkflow, 'function');
    // Part 1 behavior still intact.
    W.AxiomOrchestrator.registerAgent({ id: 'plain', handler: async () => 'ok' });
    const id = W.AxiomOrchestrator.dispatch({ agentId: 'plain', type: 'default' });
    await tick(20);
    assert.strictEqual(W.AxiomOrchestrator.getTask(id).status, 'completed');
    // Part 3 behavior still intact.
    assert.strictEqual(typeof W.AxiomOrchestrator.route, 'function');
  });

  await test('createWorkflow() rejects empty stage lists and duplicate stage ids', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    assert.throws(() => W.AxiomOrchestrator.createWorkflow({ stages: [] }));
    assert.throws(() => W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'a', agentId: 'executive' }, { id: 'a', agentId: 'research' }]
    }));
  });

  await test('createWorkflow() detects circular dependencies at creation time', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    assert.throws(() => W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'a', agentId: 'executive', dependsOn: ['b'] },
        { id: 'b', agentId: 'research', dependsOn: ['a'] }
      ]
    }), /Circular dependency/);
  });

  await test('createWorkflow() rejects a stage that depends on an unknown stage id', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    assert.throws(() => W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'a', agentId: 'executive', dependsOn: ['ghost'] }]
    }), /unknown stage/);
  });

  await test('validateWorkflow() flags a stage whose capability has no eligible agent', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'a', capability: 'no-such-capability' }]
    });
    const result = W.AxiomOrchestrator.validateWorkflow(wf.id);
    assert.strictEqual(result.valid, false);
    assert.ok(result.problems[0].indexOf('no-such-capability') !== -1);
  });

  await test('optimizeWorkflow() groups independent stages into the same wave', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] },
        { id: 'browse', capability: 'browse', dependsOn: ['plan'] },
        { id: 'remember', capability: 'memory:write', dependsOn: ['research', 'browse'] }
      ]
    });
    const plan = W.AxiomOrchestrator.optimizeWorkflow(wf.id);
    assert.strictEqual(plan.waves[0].length, 1);
    assert.strictEqual(plan.waves[0][0], 'plan');
    assert.strictEqual(plan.waves[1].slice().sort().join(','), 'browse,research');
    assert.strictEqual(plan.waves[2].join(','), 'remember');
  });

  await test('executeWorkflow() runs a full sequential collaboration chain and propagates context between stages', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      name: 'research-and-remember',
      stages: [
        { id: 'plan', agentId: 'executive', input: (ctx) => ctx.trigger },
        { id: 'research', capability: 'research', dependsOn: ['plan'], input: (ctx) => ctx.outputs.plan },
        { id: 'browse', capability: 'browse', dependsOn: ['research'], input: (ctx) => ctx.outputs.research.findings },
        {
          id: 'remember', capability: 'memory:write', dependsOn: ['browse', 'research'],
          input: (ctx) => ({ findings: ctx.outputs.research.findings, page: ctx.outputs.browse.page })
        },
        { id: 'summarize', agentId: 'executive', dependsOn: ['remember'], input: (ctx) => ctx.outputs }
      ]
    });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, { topic: 'ai news' });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.stages.length, 5);
    result.stages.forEach((s) => assert.strictEqual(s.status, 'completed'));
    assert.strictEqual(result.context.outputs.research.via, 'research');
    assert.strictEqual(result.context.outputs.browse.via, 'browser');
    assert.strictEqual(result.context.outputs.remember.stored, true);
    assert.strictEqual(result.context.outputs.remember.of.page, 'fetched');
  });

  await test('a stage only receives the payload its own input() selects — not the whole shared context object', async () => {
    const W = loadSandbox();
    let seenPayload = null;
    registerCollabAgents(W, {
      researchHandler: async (task) => { seenPayload = task.payload; return { via: 'research', findings: [] }; }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive', input: (ctx) => ctx.trigger },
        { id: 'research', capability: 'research', dependsOn: ['plan'], input: (ctx) => ctx.outputs.plan.saw }
      ]
    });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, 'find AI news');
    assert.strictEqual(seenPayload, 'find AI news');
  });

  await test('dependency resolution: a stage never starts before all of its dependsOn stages have finished', async () => {
    const W = loadSandbox();
    const events = [];
    registerCollabAgents(W, {
      executiveHandler: async () => { events.push('plan'); return { ok: true }; },
      researchHandler: async () => { events.push('research'); return { ok: true }; },
      browserHandler: async () => { events.push('browse'); return { ok: true }; }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] },
        { id: 'browse', capability: 'browse', dependsOn: ['research'] }
      ]
    });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.deepStrictEqual(events, ['plan', 'research', 'browse']);
  });

  await test('optional stage that exhausts recovery is skipped, and the workflow still completes', async () => {
    const W = loadSandbox();
    registerCollabAgents(W, {
      browserHandler: async () => { throw new Error('site is down'); }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'browse', capability: 'browse', dependsOn: ['plan'], optional: true },
        { id: 'summarize', agentId: 'executive', dependsOn: ['browse'] }
      ]
    });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'completed');
    const browseStage = result.stages.find((s) => s.id === 'browse');
    assert.strictEqual(browseStage.status, 'skipped');
    const summarizeStage = result.stages.find((s) => s.id === 'summarize');
    assert.strictEqual(summarizeStage.status, 'completed');
  });

  await test('a required (non-optional) stage failure fails the workflow gracefully and skips downstream stages', async () => {
    const W = loadSandbox();
    registerCollabAgents(W, {
      researchHandler: async () => { throw new Error('research backend unreachable'); }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] },
        { id: 'remember', capability: 'memory:write', dependsOn: ['research'] }
      ]
    });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.stages.find((s) => s.id === 'research').status, 'failed');
    assert.strictEqual(result.stages.find((s) => s.id === 'remember').status, 'skipped');
  });

  await test('retry recovery: a stage that fails once and succeeds on retry completes without failing the workflow', async () => {
    const W = loadSandbox();
    let calls = 0;
    registerCollabAgents(W, {
      researchHandler: async () => { calls++; if (calls === 1) throw new Error('flaky'); return { via: 'research', findings: [] }; }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'research', capability: 'research', maxRetries: 2 }]
    });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(calls, 2);
    assert.strictEqual(result.stages[0].attempts, 2);
  });

  await test('alternate-agent recovery: an explicit-agent stage fails over to alternateAgentIds', async () => {
    const W = loadSandbox();
    W.AxiomOrchestrator.registerAgent({
      id: 'primary-writer', capabilities: ['write'], handler: async () => { throw new Error('primary down'); }
    });
    W.AxiomOrchestrator.registerAgent({
      id: 'backup-writer', capabilities: ['write'], handler: async () => ({ via: 'backup-writer' })
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'write', agentId: 'primary-writer', alternateAgentIds: ['backup-writer'] }]
    });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.stages[0].agentId, 'backup-writer');
    assert.strictEqual(result.context.outputs.write.via, 'backup-writer');
  });

  await test('a failing stage never crashes the Orchestrator — subsequent dispatch()/route() calls keep working', async () => {
    const W = loadSandbox();
    registerCollabAgents(W, { researchHandler: async () => { throw new Error('boom'); } });
    const wf = W.AxiomOrchestrator.createWorkflow({ stages: [{ id: 'research', capability: 'research' }] });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    const outcome = W.AxiomOrchestrator.route({ capability: 'plan', payload: {} });
    assert.strictEqual(outcome.accepted, true);
    await tick(30);
    assert.strictEqual(W.AxiomOrchestrator.getTaskStatus(outcome.requestId).status, 'completed');
  });

  await test('pauseWorkflow()/resumeWorkflow() park and resume execution between stage boundaries', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] }
      ]
    });
    let paused = false;
    W.AxiomOrchestrator.on('workflow_paused', () => { paused = true; });
    const execPromise = W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    W.AxiomOrchestrator.pauseWorkflow(wf.id);
    await tick(30);
    assert.strictEqual(paused, true);
    assert.strictEqual(W.AxiomOrchestrator.getWorkflow(wf.id).status, 'paused');
    W.AxiomOrchestrator.resumeWorkflow(wf.id);
    const result = await execPromise;
    assert.strictEqual(result.status, 'completed');
  });

  await test('cancelWorkflow() on a not-yet-started workflow resolves synchronously to cancelled', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({ stages: [{ id: 'plan', agentId: 'executive' }] });
    const ok = W.AxiomOrchestrator.cancelWorkflow(wf.id);
    assert.strictEqual(ok, true);
    assert.strictEqual(W.AxiomOrchestrator.getWorkflow(wf.id).status, 'cancelled');
  });

  await test('cancelWorkflow() on a paused workflow wakes it up and marks it cancelled without running remaining stages', async () => {
    const W = loadSandbox();
    let researchRan = false;
    registerCollabAgents(W, { researchHandler: async () => { researchRan = true; return { via: 'research' }; } });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] }
      ]
    });
    const execPromise = W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    W.AxiomOrchestrator.pauseWorkflow(wf.id);
    await tick(30);
    W.AxiomOrchestrator.cancelWorkflow(wf.id);
    const result = await execPromise;
    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(researchRan, false);
  });

  await test('getWorkflow()/listWorkflows()/getWorkflowStatus()/getActiveWorkflows() report accurate live state', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf1 = W.AxiomOrchestrator.createWorkflow({ stages: [{ id: 'plan', agentId: 'executive' }] });
    const wf2 = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] }
      ]
    });
    const execPromise = W.AxiomOrchestrator.executeWorkflow(wf2.id, {});
    assert.strictEqual(W.AxiomOrchestrator.getActiveWorkflows().length, 1);
    await execPromise;
    await W.AxiomOrchestrator.executeWorkflow(wf1.id, {});
    assert.strictEqual(W.AxiomOrchestrator.listWorkflows({ status: 'completed' }).length, 2);
    assert.strictEqual(W.AxiomOrchestrator.getActiveWorkflows().length, 0);
    const status = W.AxiomOrchestrator.getWorkflowStatus(wf2.id);
    assert.strictEqual(status.stageCounts.completed, 2);
  });

  await test('getWorkflowMetrics() aggregates workflow and stage counts across every created workflow', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({ stages: [{ id: 'plan', agentId: 'executive' }] });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    const metrics = W.AxiomOrchestrator.getWorkflowMetrics();
    assert.strictEqual(metrics.totalWorkflows, 1);
    assert.strictEqual(metrics.byStatus.completed, 1);
    assert.strictEqual(metrics.stageTotals.completed, 1);
  });

  await test('works without capability-router.js loaded, falling back to raw AxiomOrchestrator.dispatch()', async () => {
    const W = loadSandbox({ withRouter: false });
    W.AxiomOrchestrator.registerAgent({ id: 'lone', capabilities: ['solo'], handler: async () => ({ ok: true }) });
    const wf = W.AxiomOrchestrator.createWorkflow({ stages: [{ id: 'only', capability: 'solo' }] });
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'completed');
  });

  await test('workflow lifecycle events fire in the expected order for a two-stage happy path', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const seen = [];
    ['workflow_started', 'workflow_stage_started', 'workflow_stage_completed', 'workflow_completed'].forEach((evt) => {
      W.AxiomOrchestrator.on(evt, () => seen.push(evt));
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] }
      ]
    });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.deepStrictEqual(seen, [
      'workflow_started', 'workflow_stage_started', 'workflow_stage_completed',
      'workflow_stage_started', 'workflow_stage_completed', 'workflow_completed'
    ]);
  });

  // ============================================================
  // Stabilization Pass — Block 2 / Step 6 / Part 6 prep
  // FIX 3: Workflow Planner uses Runtime Context (not a private
  // context store) / FIX 4: no createContext naming collision
  // ============================================================

  await test('FIX 3/4: module requires runtime-context.js to be loaded first', () => {
    assert.throws(() => loadSandbox({ withRuntimeContext: false }), /runtime-context\.js/);
  });

  await test('FIX 3/4: workflow-planner.js no longer defines its own createContext (no naming collision)', () => {
    const src = fs.readFileSync(path.join(AI, 'os/core/workflow-planner.js'), 'utf8');
    assert.strictEqual(/function\s+createContext\s*\(/.test(src), false);
  });

  await test('FIX 3: executeWorkflow() creates a real Runtime Context for the run and it is visible mid-flight', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const seenContextIds = [];
    W.AxiomOrchestrator.on('workflow_stage_started', () => {
      const active = W.AxiomRuntimeContext.getActiveContexts();
      seenContextIds.push(active.map((c) => c.workflowId));
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'plan', agentId: 'executive' }]
    });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, { trigger: 'go' });
    assert.ok(seenContextIds.length > 0);
    assert.ok(seenContextIds[0].indexOf(wf.id) !== -1);
  });

  await test('FIX 3: a completed workflow\'s Runtime Context is destroyed (create -> update -> destroy lifecycle)', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'plan', agentId: 'executive' }]
    });
    let capturedContextId = null;
    W.AxiomOrchestrator.on('context_destroyed', ({ contextId }) => { capturedContextId = contextId; });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, { trigger: 'go' });
    assert.ok(capturedContextId);
    assert.strictEqual(W.AxiomRuntimeContext.getContext(capturedContextId), null);
  });

  await test('FIX 3: a failed workflow\'s Runtime Context is finalized as failed, then destroyed', async () => {
    const W = loadSandbox();
    registerCollabAgents(W, {
      researchHandler: async () => { throw new Error('research is down'); }
    });
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'research', capability: 'research' }]
    });
    let contextStatuses = [];
    W.AxiomOrchestrator.on('context_status_changed', (p) => contextStatuses.push(p.to));
    const result = await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(result.status, 'failed');
    assert.ok(contextStatuses.indexOf('failed') !== -1);
  });

  await test('FIX 3: a cancelled-before-start workflow never leaks an orphaned Runtime Context', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [{ id: 'plan', agentId: 'executive' }]
    });
    W.AxiomOrchestrator.cancelWorkflow(wf.id, 'never started');
    // No executeWorkflow() call was ever made, so no Runtime Context
    // should have been created at all for this workflow id.
    assert.strictEqual(W.AxiomRuntimeContext.getContextsByWorkflow(wf.id).length, 0);
  });

  await test('FIX 3: exactly one Runtime Context exists at a time per in-flight workflow run', async () => {
    const W = loadSandbox();
    registerCollabAgents(W);
    const wf = W.AxiomOrchestrator.createWorkflow({
      stages: [
        { id: 'plan', agentId: 'executive' },
        { id: 'research', capability: 'research', dependsOn: ['plan'] }
      ]
    });
    let maxSeen = 0;
    W.AxiomOrchestrator.on('workflow_stage_started', () => {
      maxSeen = Math.max(maxSeen, W.AxiomRuntimeContext.getContextsByWorkflow(wf.id).length);
    });
    await W.AxiomOrchestrator.executeWorkflow(wf.id, {});
    assert.strictEqual(maxSeen, 1);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
