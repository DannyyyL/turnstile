import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runValidation, validateValidationOptions } from '../benchmark/legacy-validation.mjs';
import { TASKS, createReferencePolicy } from '../benchmark/index.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('matched validation is reproducible, content addressed and preserves case-level pairing', async () => {
  const a = await runValidation({ seedCount: 2 });
  const b = await runValidation(a.options);
  assert.deepEqual(a, b);
  const { reportHash, ...body } = a;
  assert.equal(reportHash, hash(body));
  assert.equal(a.kind, 'temporal_validation');
  assert.equal(a.status, 'completed');
  assert.equal(a.conditions.length, 8);
  assert.equal(a.pairs.length, 8);
  assert.equal(a.summary.length, 8 * 4);
  assert.equal(a.protocol.recoveryTested, false);
  assert.equal(a.costs.modelUsage, null);
  for (const condition of a.conditions) {
    assert.equal(condition.report.cases.length, 2);
    assert.deepEqual(condition.report.cases.map(c => c.seed), [42, 43]);
    assert.ok(condition.report.cases.every(c => c.runs.every(r => r.attempts.length === 1)));
  }
  for (const pair of a.pairs) {
    assert.equal(pair.caseDeltas.length, 8);
    for (const row of pair.caseDeltas) {
      assert.ok(row.firstComplete);
      assert.equal(row.firstAttemptScoreDelta, row.treatment.firstAttemptScore - row.control.firstAttemptScore);
      assert.equal(row.finalScoreDelta, row.treatment.finalScore - row.control.finalScore);
    }
  }
  const actual = field => a.conditions.reduce((n, c) => n + c.report.costs[field], 0);
  for (const field of ['physicalForwardActions', 'physicalForwardEffort', 'physicalPolicyDecisions', 'physicalAutomaticActions', 'replayActions', 'replayEffort']) assert.equal(a.costs[field], actual(field));
});

test('delay and interference contrasts hold task, seed, actions and reference effort fixed', async () => {
  const report = await runValidation({ seedCount: 3, strategies: ['forward_only'] });
  for (const pair of report.pairs.filter(p => p.factor !== 'invalidation_and_expiry')) {
    const control = report.conditions.find(c => c.id === pair.control), treatment = report.conditions.find(c => c.id === pair.treatment);
    for (let i = 0; i < control.report.cases.length; i++) {
      const a = control.report.cases[i], b = treatment.report.cases[i];
      assert.equal(a.taskId, b.taskId); assert.equal(a.seed, b.seed);
      const firstA = a.runs[0].attempts[0], firstB = b.runs[0].attempts[0];
      assert.deepEqual(firstA.steps.map(s => s.action), firstB.steps.map(s => s.action));
      assert.equal(firstA.effort, firstB.effort);
      assert.equal(firstA.score, firstB.score);
    }
    assert.ok(pair.caseDeltas.every(row => row.firstAttemptScoreDelta === 0));
  }
  for (const pair of report.pairs.filter(p => p.factor === 'invalidation_and_expiry')) {
    const a = report.conditions.find(c => c.id === pair.control), b = report.conditions.find(c => c.id === pair.treatment);
    assert.equal(a.stateMode, 'updates'); assert.equal(b.stateMode, 'temporal');
    assert.equal(a.interference, b.interference);
  }
});

test('delayed first-attempt conditions are input-identical negative controls before any revealing probe', async () => {
  const fixture = createReferencePolicy(), contexts = new Map();
  await runValidation({ strategies: ['forward_only'], attempts: 1 }, { policyFactory({ condition }) {
    if (condition.family === 'delayed_consequences') contexts.set(condition.id, []);
    return { async decide(context) {
      if (condition.family === 'delayed_consequences') contexts.get(condition.id).push(structuredClone(context));
      return fixture.decide(context);
    } };
  } });
  assert.equal(contexts.size, 4);
  const baseline = contexts.get('delay_short_clean');
  assert.deepEqual(baseline.map(c => c.t), [1, 2, 3, 4]);
  for (const inputs of contexts.values()) assert.deepEqual(inputs, baseline);
  // Therefore a changed first-pass model result across these conditions would
  // reflect repeated inference variability, not additional observed delay/noise.
});

test('error cases remain visible and do not masquerade as paired temporal score changes', async () => {
  const fixture = createReferencePolicy();
  let conditionNumber = 0;
  const report = await runValidation({ strategies: ['forward_only'] }, { policyFactory() {
    const current = conditionNumber++;
    return current === 1 ? { decide() { throw new Error('private runtime detail'); } } : fixture;
  } });
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(report.conditions[1].report.status, 'completed_with_errors');
  assert.ok(!JSON.stringify(report).includes('private runtime detail'));
  const delayPair = report.pairs.find(pair => pair.id === 'delay_without_interference');
  const delta = delayPair.caseDeltas[0];
  assert.equal(delta.firstComplete, false);
  assert.equal(delta.firstAttemptScoreDelta, null);
  assert.equal(delta.firstAttemptSuccessDelta, null);
  assert.equal(delayPair.summary[0].completeFirstPairs, 0);
  assert.equal(delayPair.summary[0].incompleteFirstPairs, 1);
  assert.equal(delayPair.summary[0].meanFirstAttemptScoreDelta, null);
  assert.equal(delayPair.summary[0].treatmentErrors, 1);
  assert.equal(delayPair.summary[0].controlErrors, 0);
  assert.equal(report.summary.find(row => row.conditionId === 'delay_long_clean').errors, 1);
});

test('condition starts have no prior-condition assistance and a fresh adapter is available per condition', async () => {
  const seen = [], fixture = createReferencePolicy();
  const report = await runValidation({ attempts: 2, strategies: ['trace_memory'], analysisBudget: 0 }, { policyFactory({ condition }) {
    let firstDecision = true;
    return { async decide(context) {
      if (firstDecision) {
        firstDecision = false;
        seen.push(condition.id);
        assert.equal(context.attempt, 1);
        assert.deepEqual(context.previousAttempts, []);
        assert.deepEqual(context.hints, []);
        assert.equal(context.reflectionMemory, null);
        assert.ok(!Object.hasOwn(context, 'split'));
        assert.ok(!Object.hasOwn(context, 'condition'));
        assert.ok(!Object.hasOwn(context, 'taskId'));
      }
      return fixture.decide(context);
    } };
  } });
  assert.equal(report.protocol.policyLifecycle, 'fresh_policy_per_condition');
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  assert.equal(report.protocol.recoveryTested, true);
});

test('validation evaluation split uses different public task structures rather than different seeds', async () => {
  const report = await runValidation({ split: 'evaluation', strategies: ['forward_only'] });
  const selected = [...new Set(report.conditions.map(c => c.taskId))];
  assert.equal(selected.length, 2);
  assert.ok(selected.every(id => TASKS.find(task => task.id === id).split === 'evaluation'));
  assert.ok(!selected.includes('temporal_release')); assert.ok(!selected.includes('state_ledger'));
  assert.equal(report.conditions.length, 8);
  assert.equal(report.options.seed, 42);
  assert.ok(report.limitations.some(text => text.includes('not secret')));
});

test('validation rejects matrix overrides, excessive operations and accidental model fallback', async () => {
  assert.equal(validateValidationOptions({}).attempts, 1);
  assert.equal(validateValidationOptions({}).analysisBudget, 4);
  for (const options of [{ taskId: 'temporal_release' }, { delay: 2 }, { stateMode: 'updates' }, { interference: 1 }, { split: 'all' }, { seedCount: 11 }, { attempts: 3 }, { policyKind: 'compatible', seedCount: 4 }, { seed: 2147483647, seedCount: 2 }]) assert.throws(() => validateValidationOptions(options));
  await assert.rejects(() => runValidation({ policyKind: 'compatible' }), /explicit policy/);
  await assert.rejects(() => runValidation({}, { policy: {}, policyFactory() {} }), /not both/);
  await assert.rejects(() => runValidation({}, { policyFactory: 'invalid' }), /function/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => runValidation({}, { signal: controller.signal }), error => error.code === 'CANCELLED');
});
