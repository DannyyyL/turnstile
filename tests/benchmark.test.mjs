import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runBenchmark, createTask, replayTask, createReferencePolicy, validateBenchmarkOptions, STRATEGIES } from '../benchmark/index.mjs';
import { ModelError } from '../model.mjs';

const one = { taskId: 'temporal_release', seed: 42 };
const runFor = (report, strategy) => report.cases[0].runs.find(r => r.strategy === strategy);
function informedReleasePolicy() {
  return { async decide(c) {
    let actionId = c.actions[0].id;
    if (c.checkpointId === 'inspection') actionId = 'inspect';
    else if (c.actions.length > 1) actionId = c.history[0].result.split('. ')[0].includes(c.checkpointId) ? 'guarded' : 'basic';
    return { actionId, reasoning: 'Use the observed inspection and published budget.' };
  } };
}

test('reports are reproducible, reusable and content-addressed with family-specific scoring', async () => {
  const a = await runBenchmark({ suite: 'legacy', seedCount: 2 });
  const b = await runBenchmark(a.options);
  assert.deepEqual(a, b);
  assert.equal(a.cases.length, 8);
  assert.equal(new Set(a.cases.map(c => c.family)).size, 2);
  const { reportHash, ...body } = a;
  assert.equal(reportHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  for (const row of a.summary) {
    assert.equal(row.recoveryRate, row.recoveryEligible ? row.recoveries / row.recoveryEligible : null);
    assert.equal(row.firstAttemptSuccessRate, row.firstAttemptSuccesses / row.cases);
  }
  const logical = a.cases.flatMap(c => c.runs).reduce((n, r) => n + r.metrics.forwardActions, 0);
  assert.equal(logical - a.costs.physicalForwardActions, 8 * 14 * 3);
});

test('delay moves only the probe, preserving workload, horizon, action order and effort', async () => {
  for (let seed = 0; seed < 8; seed++) {
    const early = await runBenchmark({ ...one, seed, delay: 0, attempts: 1 });
    const late = await runBenchmark({ ...one, seed, delay: 7, attempts: 1 });
    const a = early.cases[0].runs[0].attempts[0], b = late.cases[0].runs[0].attempts[0];
    assert.equal(a.steps.length, 14); assert.equal(b.steps.length, 14);
    assert.equal(a.effort, b.effort);
    assert.deepEqual(a.steps.map(s => s.action), b.steps.map(s => s.action));
    assert.deepEqual(a.outcome.failures.map(f => f.id), b.outcome.failures.map(f => f.id));
    for (let i = 0; i < a.outcome.failures.length; i++) assert.equal(b.outcome.failures[i].detectedAt - a.outcome.failures[i].detectedAt, 7);
  }
});

test('careful initial inspection earns first-attempt success without recovery or analysis credit', async () => {
  for (const taskId of ['temporal_release', 'temporal_dispatch']) {
    const report = await runBenchmark({ taskId, seedCount: 6, policyKind: 'custom' }, { policy: informedReleasePolicy() });
    assert.equal(report.costs.physicalForwardActions, 6 * 14);
    for (const run of report.cases.flatMap(c => c.runs)) {
      assert.equal(run.attempts.length, 1); assert.equal(run.attempts[0].effort, 8);
      assert.equal(run.metrics.firstAttemptSuccess, true); assert.equal(run.metrics.finalScore, 1);
      assert.equal(run.metrics.recoveryEligible, false); assert.equal(run.metrics.recoveredAfterFailure, false);
      assert.equal(run.analyses.length, 0);
    }
    assert.ok(report.summary.every(row => row.recoveryRate === null));
  }
});

test('temporal ledger scores late arrivals, retroactive retractions and exclusive expiration', async () => {
  const policy = { async decide(c) {
    if (c.actions.length === 1) return { actionId: c.actions[0].id, reasoning: 'Record event.' };
    const events = c.history.filter(s => s.observation.startsWith('Received ledger event: ')).map(s => JSON.parse(s.observation.slice('Received ledger event: '.length)));
    // The first query must use e4: e2 was retracted, and late-arriving e3 is older.
    // The second must return none: e5 expires exactly at time 7, without fallback.
    // The last query uses e7 until 11; e8 arrived later but is effective earlier.
    const asOf = Number(/effective time (\d+)/.exec(c.observation)[1]);
    const actionId = c.t === 6 ? events.find(e => e.id === 'e4').value : c.t === 10 || asOf >= 11 ? 'none' : events.find(e => e.id === 'e7').value;
    return { actionId, reasoning: 'Apply the effective-time, retraction and expiry rules.' };
  } };
  const report = await runBenchmark({ suite: 'legacy', family: 'temporal_state_tracking', seedCount: 8, policyKind: 'custom' }, { policy });
  assert.ok(report.cases.every(c => c.runs.every(r => r.metrics.firstAttemptSuccess)));
});

test('strategies share one real first attempt, own their data and enforce memory/delivery boundaries', async () => {
  const fixture = createReferencePolicy(), contexts = [], analyses = [];
  const policy = {
    async decide(c) { contexts.push(structuredClone(c)); return fixture.decide(c); },
    reflect(c) { analyses.push(structuredClone(c)); return fixture.reflect(c); },
    invert(c) { analyses.push(structuredClone(c)); return fixture.invert(c); },
  };
  const report = await runBenchmark(one, { policy });
  const runs = report.cases[0].runs;
  assert.equal(contexts.filter(c => c.attempt === 1).length, 4);
  assert.ok(contexts.filter(c => c.attempt === 1).every(c => c.hints.length === 0 && c.reflectionMemory === null && c.previousAttempts.length === 0));
  assert.equal(contexts.filter(c => c.attempt === 2 && c.previousAttempts.length).length, 4);
  for (const c of contexts) {
    assert.ok(!Object.hasOwn(c, 'seed')); assert.ok(!Object.hasOwn(c, 'taskId'));
    assert.ok(!Object.hasOwn(c, 'definitions')); assert.ok(!Object.hasOwn(c, 'answers'));
    assert.ok(c.history.every(s => s.t < c.t));
    assert.ok(c.hints.every(h => h.checkpointId === c.checkpointId && h.sourceAttempt < c.attempt));
  }
  assert.deepEqual(analyses[0], analyses[1]);
  assert.equal(analyses[0].trajectory.length, 14);
  assert.ok(!JSON.stringify(analyses).includes('decisionT'));
  const reflection = runFor(report, 'reflection'), pincer = runFor(report, 'temporal_pincer');
  assert.equal(reflection.metrics.finalSuccess, true); assert.equal(pincer.metrics.finalSuccess, true);
  assert.ok(reflection.attempts[1].deliveries.every(d => d.t === 1));
  assert.ok(pincer.attempts[1].deliveries.every(d => d.cards.every(c => c.targetT === d.t)));
  runs[0].attempts[0].steps[0].action.id = 'mutated';
  assert.notEqual(runs[1].attempts[0].steps[0].action.id, 'mutated');
});

test('actor contexts do not reveal future ledger events or prior attempts in fresh retries', async () => {
  const fixture = createReferencePolicy();
  const policy = { ...fixture, async decide(c) {
    if (c.t === 1) assert.ok(!JSON.stringify(c).includes('e8'));
    if (c.t === 6) assert.ok(!JSON.stringify(c).includes('"id":"e5"'));
    assert.equal(c.previousAttempts.length, 0);
    return fixture.decide(c);
  } };
  const report = await runBenchmark({ taskId: 'state_ledger', strategies: ['forward_only'] }, { policy });
  assert.equal(report.status, 'completed');
});

test('replay fixes one action, keeps local repair distinct from task success and retains negative controls', async () => {
  const report = await runBenchmark(one);
  const source = report.cases[0].runs[0].attempts[0];
  const analysis = runFor(report, 'reflection').analyses[0];
  assert.ok(analysis.candidateTests.some(t => !t.accepted && t.replay));
  const accepted = analysis.candidateTests.find(t => t.accepted);
  assert.equal(accepted.replay.outcome.success, false);
  assert.equal(accepted.removedFailureIds.length, 1);
  const task = createTask(one);
  const replay = replayTask(task, source, { checkpointId: analysis.cards[0].checkpointId, actionId: analysis.cards[0].actionId });
  assert.equal(replay.actions, 14);
  assert.equal(replay.fixedActions.filter((a, i) => a.actionId !== source.steps[i].action.id).length, 1);
  assert.throws(() => replayTask(createTask({ ...one, seed: 43 }), source, analysis.cards[0]), /same task instance/);
  const invalid = structuredClone(source);
  [invalid.steps[0], invalid.steps[1]] = [invalid.steps[1], invalid.steps[0]];
  assert.throws(() => replayTask(task, invalid, analysis.cards[0]), /reordered/);
  invalid.steps.pop();
  assert.throws(() => replayTask(task, invalid, analysis.cards[0]), /completed/);
});

test('replay rejects a budget-breaking repair and never delivers an unverified proposal', async () => {
  const fixture = createReferencePolicy();
  const policy = { ...fixture, async decide(c) {
    if (c.attempt === 1 && c.actions.length > 1) return { actionId: c.checkpointId === 'inspection' ? 'skip' : c.checkpointId === 'persistence' ? 'basic' : 'guarded', reasoning: 'Budget test.' };
    return fixture.decide(c);
  }, reflect() { return { summary: 'Propose the missing guard.', recommendations: [{ targetT: 2, actionId: 'guarded', reasoning: 'Test a guard that may exceed budget.' }] }; } };
  let found = false;
  for (let seed = 0; seed < 6 && !found; seed++) {
    const report = await runBenchmark({ ...one, seed, strategies: ['reflection'] }, { policy });
    const tests = report.cases[0].runs[0].analyses[0]?.candidateTests ?? [];
    if (tests[0]?.removedFailureIds?.length) {
      found = true;
      assert.equal(tests[0].accepted, false);
      assert.ok(tests[0].introducedFailureIds.includes('effort_budget'));
      assert.equal(report.cases[0].runs[0].metrics.deliveredCards, 0);
    }
  }
  assert.equal(found, true);
  const zero = await runBenchmark({ ...one, analysisBudget: 0 });
  for (const run of zero.cases[0].runs) { assert.equal(run.metrics.replays, 0); assert.equal(run.metrics.deliveredCards, 0); }
  assert.ok(runFor(zero, 'reflection').analyses[0].candidateTests.some(t => t.reason === 'replay_budget_exhausted'));
});

test('invalid model actions and analyst failures are explicit report errors with no fallback', async () => {
  const report = await runBenchmark(one, { policy: { decide() { throw new Error('private credentials'); } } });
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(report.options.policyKind, 'custom');
  assert.deepEqual(report.cases[0].evaluation.observedFailureDelays, []);
  assert.ok(!JSON.stringify(report).includes('private credentials'));
  for (const run of report.cases[0].runs) {
    assert.equal(run.attempts.length, 1); assert.equal(run.metrics.firstAttemptScore, null);
    assert.equal(run.metrics.recoveryEligible, false); assert.equal(run.status, 'error');
  }
  const fixture = createReferencePolicy();
  const brokenAnalyst = await runBenchmark({ ...one, strategies: ['reflection', 'temporal_pincer'] }, { policy: { ...fixture, reflect() { throw new ModelError('provider error', 'MODEL_INCOMPLETE'); } } });
  assert.equal(runFor(brokenAnalyst, 'reflection').status, 'error');
  assert.equal(runFor(brokenAnalyst, 'reflection').attempts.length, 1);
  assert.equal(runFor(brokenAnalyst, 'temporal_pincer').status, 'completed');
});

test('the trace-memory baseline can recover from its raw evidence without an analyst', async () => {
  const fixture = createReferencePolicy();
  const policy = { async decide(c) {
    if (c.previousAttempts.length && c.actions.some(a => a.id === 'guarded')) {
      const previous = c.previousAttempts.at(-1);
      const failure = previous.outcome.failures.some(f => f.id === c.checkpointId);
      return { actionId: failure ? 'guarded' : 'basic', reasoning: 'Use the earlier completed probe result.' };
    }
    return fixture.decide(c);
  } };
  const report = await runBenchmark({ ...one, strategies: ['forward_only', 'trace_memory'] }, { policy });
  assert.equal(runFor(report, 'forward_only').metrics.finalSuccess, false);
  assert.equal(runFor(report, 'trace_memory').metrics.finalSuccess, true);
  assert.equal(runFor(report, 'trace_memory').metrics.replays, 0);
  assert.equal(runFor(report, 'trace_memory').analyses.length, 0);
});

test('passing all integration gates while exceeding effort remains a task failure', async () => {
  const policy = { async decide(c) { return { actionId: c.actions.some(a => a.id === 'guarded') ? 'guarded' : c.actions[0].id, reasoning: 'Select every guard.' }; } };
  const report = await runBenchmark({ ...one, attempts: 1 }, { policy });
  const first = report.cases[0].runs[0].attempts[0];
  assert.equal(first.score, 0.75); assert.equal(first.success, false);
  assert.deepEqual(first.outcome.failures.map(f => f.id), ['effort_budget']);
  assert.deepEqual(report.cases[0].evaluation.observedFailureDelays, []);
});

test('validation bounds experiments and CLI produces a parseable offline report', () => {
  for (const options of [{ delay: 8 }, { seedCount: 51 }, { attempts: 6 }, { strategies: ['unknown'] }, { strategies: ['reflection', 'reflection'] }, { policyKind: 'compatible', seedCount: 4 }, { taskId: 'state_ledger', family: 'delayed_consequences' }]) assert.throws(() => validateBenchmarkOptions(options));
  assert.equal(STRATEGIES.length, 4);
  const child = spawnSync(process.execPath, ['cli.mjs', 'evaluate', '--suite', 'legacy', '--family', 'temporal_state_tracking', '--attempts', '1'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).cases.length, 2);
});

test('forced operations are automatic while policy sees their complete observable history', async () => {
  const contexts = [], fixture = createReferencePolicy();
  const report = await runBenchmark({ taskId: 'state_ledger', attempts: 1 }, { policy: { ...fixture, decide(c) { contexts.push(c); return fixture.decide(c); } } });
  assert.equal(report.schemaVersion, 4);
  assert.equal(report.benchmarkVersion, '0.5.0');
  assert.equal(contexts.length, 3);
  assert.deepEqual(contexts.map(c => c.t), [6, 10, 14]);
  assert.equal(contexts[0].history.length, 5);
  assert.ok(contexts[0].history.every(s => s.execution === 'automatic'));
  const first = report.cases[0].runs[0].attempts[0];
  assert.equal(first.steps.length, 14);
  assert.equal(first.automaticActions, 11);
  assert.equal(first.policyDecisions, 3);
  assert.equal(report.costs.physicalAutomaticActions, 11);
  assert.equal(report.costs.physicalPolicyDecisions, 3);
});

test('cancellation reaches automatic steps and prevents further policy calls', async () => {
  const controller = new AbortController();
  let calls = 0;
  const report = await runBenchmark({ taskId: 'state_ledger', attempts: 1 }, { signal: controller.signal, policy: { decide(c) {
    calls++; controller.abort(); return { actionId: c.actions[0].id, reasoning: 'Record then cancel.' };
  } } });
  assert.equal(calls, 1);
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(report.cases[0].runs[0].attempts[0].error.code, 'CANCELLED');
});
