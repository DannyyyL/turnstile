import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TEMPORAL_TASKS as ACTIVE_TASKS, BENCHMARK_VERSION, runBenchmark as runSelectedBenchmark, validateBenchmarkOptions as validateSelectedOptions } from '../benchmark/index.mjs';
import { runValidation, validateValidationOptions } from '../benchmark/state-validation.mjs';

// Preserve the v0.4 foundational diagnostic tests under its explicit suite.
const runBenchmark = (options = {}, dependencies) => runSelectedBenchmark({ suite: 'temporal', ...options }, dependencies);
const validateBenchmarkOptions = (options = {}) => validateSelectedOptions({ suite: 'temporal', ...options });

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const data = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

// Independent policy: the runner supplies only the public rules, current
// observation/options and completed history. No task generator or key is used.
function publicAnswer(context) {
  const query = data(context.observation);
  const received = context.history.filter(step => step.observation.startsWith('Received record: '))
    .map(step => data(step.observation)).filter(record => record.receivedTime <= query.knowledgeTime);
  const cancelled = new Set(received.filter(record => record.type === 'retract').map(record => record.target));
  let latest;
  for (const record of received) {
    if (record.type !== 'assign' || cancelled.has(record.id) || record.effectiveTime > query.effectiveTime) continue;
    if (!latest || latest.effectiveTime < record.effectiveTime) latest = record;
  }
  const value = latest?.value ?? 'unknown';
  const selected = context.actions.find(action => action.description === `Answer: ${value}`);
  assert.ok(selected, 'The public answer must be an available action');
  return selected.id;
}
const competentPolicy = () => ({ decide: context => ({ actionId: publicAnswer(context), reasoning: 'Apply the published temporal rules to received records.' }) });
const firstAttempt = condition => condition.report.cases[0].runs[0].attempts[0];
const rowsFor = (report, factor) => report.pairs.filter(pair => pair.factor === factor);

function assertNoPrivateKeys(value, forbidden = new Set(['answerKey', 'answerId', 'expected', 'definitions', 'temporalAudit'])) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `Private evaluator key leaked: ${key}`);
    assertNoPrivateKeys(child, forbidden);
  }
}

test('active defaults focus on temporal reconstruction with one unassisted attempt', async () => {
  assert.deepEqual(ACTIVE_TASKS.map(task => [task.id, task.family, task.split]), [
    ['temporal_history', 'temporal_state_tracking', 'development'],
    ['temporal_revision', 'temporal_state_tracking', 'evaluation'],
  ]);
  const defaults = validateBenchmarkOptions({});
  assert.equal(defaults.suite, 'temporal');
  assert.equal(defaults.attempts, 1);
  assert.deepEqual(defaults.strategies, ['forward_only']);
  const development = await runBenchmark();
  assert.deepEqual(development.cases.map(item => item.taskId), ['temporal_history']);
  const all = await runBenchmark({ split: 'all' });
  assert.deepEqual(all.cases.map(item => item.taskId), ['temporal_history', 'temporal_revision']);
  assert.ok(all.cases.every(item => item.runs.length === 1 && item.runs[0].attempts.length === 1));
  assert.equal(all.costs.physicalPolicyDecisions, 8);
  assert.equal(all.costs.physicalAutomaticActions, 20);
  assert.equal(all.costs.modelUsage, null);
  assert.equal(all.benchmarkVersion, BENCHMARK_VERSION);
  assert.throws(() => validateBenchmarkOptions({ family: 'delayed_consequences' }), /legacy/);
  assert.throws(() => validateBenchmarkOptions({ stateMode: 'updates' }), /legacy/);
});

test('temporal benchmark and fixed validation reports are reproducible and content addressed', async () => {
  const a = await runBenchmark({ split: 'all', seedCount: 2 });
  const b = await runBenchmark(a.options);
  assert.deepEqual(a, b);
  const { reportHash, ...body } = a;
  assert.equal(reportHash, hash(body));
  assert.match(a.provenance.sourceHash, /^[a-f0-9]{64}$/);

  const controls = await runValidation({ seedCount: 2 });
  const repeated = await runValidation(controls.options);
  assert.deepEqual(controls, repeated);
  const { reportHash: controlHash, ...controlBody } = controls;
  assert.equal(controlHash, hash(controlBody));
  assert.equal(controls.conditions.length, 4);
  assert.equal(controls.pairs.length, 4);
  assert.equal(controls.protocol.recoveryTested, false);
  assert.deepEqual(controls.options.strategies, ['forward_only']);
  for (const condition of controls.conditions) {
    assert.deepEqual(condition.report.cases.map(item => item.seed), [42, 43]);
    assert.deepEqual(validateBenchmarkOptions(condition.options), condition.report.options);
    const { reportHash: childHash, ...childBody } = condition.report;
    assert.equal(childHash, hash(childBody));
  }
  for (const field of ['physicalForwardActions', 'physicalForwardEffort', 'physicalPolicyDecisions', 'physicalAutomaticActions', 'replayActions', 'replayEffort']) {
    assert.equal(controls.costs[field], controls.conditions.reduce((sum, condition) => sum + condition.report.costs[field], 0));
  }
  assertNoPrivateKeys(controls);
});

test('public temporal reasoning solves both sides of timestamp-only matched pairs', async () => {
  const report = await runValidation({ seedCount: 3 }, { policy: competentPolicy() });
  assert.equal(report.options.policyKind, 'custom');
  assert.equal(report.status, 'completed');
  assert.ok(report.conditions.every(condition => condition.report.summary.every(row => row.meanFirstAttemptScore === 1 && row.firstAttemptSuccessRate === 1)));
  for (const pair of rowsFor(report, 'temporal_relation')) {
    assert.equal(pair.temporalNecessity.onlyTemporalMetadataChanged, true);
    assert.equal(pair.temporalNecessity.answerChangeExpected, true);
    assert.ok(pair.temporalNecessity.changedQueriesPerCase.every(audit => audit.changedQueryCount === 1 && JSON.stringify(audit.changedCheckpoints) === '["query_8"]'));
    assert.ok(pair.caseDeltas.every(row => row.firstComplete && row.requiredFlipQueries === 1 && row.bothCorrectFlipQueries === 1 && row.pairedTemporalAccuracy === 1));
    assert.equal(pair.summary[0].requiredFlipQueries, 3);
    assert.equal(pair.summary[0].bothCorrectFlipQueries, 3);
    assert.equal(pair.summary[0].pairedTemporalAccuracy, 1);
    assert.equal(pair.summary[0].meanFirstAttemptScoreDelta, 0,
      'Equal aggregate accuracy can coexist with the required answer change');
    const control = report.conditions.find(condition => condition.id === pair.control);
    const treatment = report.conditions.find(condition => condition.id === pair.treatment);
    const a = firstAttempt(control), b = firstAttempt(treatment);
    assert.deepEqual(a.steps.map(step => [step.t, step.checkpointId, step.actions]), b.steps.map(step => [step.t, step.checkpointId, step.actions]));
    assert.equal(a.steps.filter((step, i) => step.observation !== b.steps[i].observation).length, 1);
    assert.notEqual(a.steps.find(step => step.checkpointId === 'query_8').action.id, b.steps.find(step => step.checkpointId === 'query_8').action.id);
  }
  for (const pair of rowsFor(report, 'irrelevant_observations')) {
    assert.ok(pair.temporalNecessity.changedQueriesPerCase.every(audit => audit.changedQueryCount === 0));
    assert.ok(pair.caseDeltas.every(row => row.firstAttemptScoreDelta === 0 && row.finalScoreDelta === 0 && row.requiredFlipQueries === 0 && row.pairedTemporalAccuracy === null));
    const a = firstAttempt(report.conditions.find(condition => condition.id === pair.control));
    const b = firstAttempt(report.conditions.find(condition => condition.id === pair.treatment));
    assert.deepEqual(a.steps.map(step => step.action), b.steps.map(step => step.action));
    assert.deepEqual(a.outcome, b.outcome);
  }
});

test('a timestamp-blind action policy cannot be correct on both answer-changing pair members', async () => {
  const report = await runValidation({ seedCount: 3 }, { policy: {
    decide: context => ({ actionId: context.actions[0].id, reasoning: 'Ignore evidence and choose the first option.' }),
  } });
  for (const pair of rowsFor(report, 'temporal_relation')) {
    assert.ok(pair.caseDeltas.every(row => row.firstComplete && row.bothCorrectFlipQueries === 0 && row.pairedTemporalAccuracy === 0));
    assert.equal(pair.summary[0].pairedTemporalAccuracy, 0);
    assert.equal(pair.summary[0].requiredFlipQueries, 3);
    const a = report.conditions.find(condition => condition.id === pair.control);
    const b = report.conditions.find(condition => condition.id === pair.treatment);
    for (let i = 0; i < a.report.cases.length; i++) {
      assert.deepEqual(a.report.cases[i].runs[0].attempts[0].steps.map(step => step.action.id), b.report.cases[i].runs[0].attempts[0].steps.map(step => step.action.id));
    }
  }
});

test('incomplete pairs keep null accuracy and deltas with explicit error and coverage counts', async () => {
  const report = await runValidation({ seedCount: 2 }, { policyFactory({ condition }) {
    return condition.id === 'shifted_clean' ? { decide() { throw new Error('private transport secret'); } } : competentPolicy();
  } });
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(JSON.stringify(report).includes('private transport secret'), false);
  const pair = report.pairs.find(item => item.id === 'temporal_clean');
  assert.ok(pair.caseDeltas.every(row => row.firstComplete === false && row.finalComplete === false
    && row.firstAttemptScoreDelta === null && row.firstAttemptSuccessDelta === null
    && row.finalScoreDelta === null && row.finalSuccessDelta === null
    && row.bothCorrectFlipQueries === null && row.pairedTemporalAccuracy === null));
  const summary = pair.summary[0];
  assert.equal(summary.pairedCases, 2);
  assert.equal(summary.completeFirstPairs, 0);
  assert.equal(summary.incompleteFirstPairs, 2);
  assert.equal(summary.controlErrors, 0);
  assert.equal(summary.treatmentErrors, 2);
  assert.equal(summary.meanFirstAttemptScoreDelta, null);
  assert.equal(summary.pairedTemporalAccuracy, null);
  assert.equal(summary.requiredFlipQueries, 0, 'Incomplete pairs must not enter the accuracy denominator');
  const complete = report.pairs.find(item => item.id === 'temporal_distracted');
  assert.equal(complete.summary[0].completeFirstPairs, 2);
  assert.equal(complete.summary[0].pairedTemporalAccuracy, 1);
});

test('evaluation validates revision of the same past at different knowledge times', async () => {
  const report = await runValidation({ split: 'evaluation' }, { policy: competentPolicy() });
  assert.deepEqual([...new Set(report.conditions.map(condition => condition.taskId))], ['temporal_revision']);
  assert.ok(report.conditions.every(condition => condition.report.cases[0].split === 'evaluation'));
  const base = firstAttempt(report.conditions.find(condition => condition.id === 'base_clean'));
  const queries = base.steps.filter(step => step.execution === 'policy');
  assert.equal(new Set(queries.map(step => data(step.observation).effectiveTime)).size, 1);
  assert.deepEqual(queries.map(step => data(step.observation).knowledgeTime), [4, 8, 11, 14]);
  assert.notEqual(queries[0].action.id, queries[1].action.id);
  assert.equal(queries[0].action.id, queries[2].action.id);
  assert.notEqual(queries[2].action.id, queries[3].action.id);
  assert.ok(base.outcome.success);
  assert.ok(rowsFor(report, 'temporal_relation').every(pair => pair.summary[0].pairedTemporalAccuracy === 1));
});

test('validation conditions start with fresh, unassisted public contexts', async () => {
  const starts = [], callCounts = new Map();
  const report = await runValidation({}, { policyFactory({ condition }) {
    let initial = true;
    callCounts.set(condition.id, 0);
    return { decide(context) {
      callCounts.set(condition.id, callCounts.get(condition.id) + 1);
      if (initial) { starts.push([condition.id, clone(context)]); initial = false; }
      return { actionId: publicAnswer(context), reasoning: 'Solve from current public evidence.' };
    } };
  } });
  assert.equal(report.protocol.policyLifecycle, 'fresh_policy_per_condition');
  assert.equal(starts.length, 4);
  assert.ok([...callCounts.values()].every(count => count === 4));
  for (const [, context] of starts) {
    assert.equal(context.attempt, 1);
    assert.deepEqual(context.hints, []);
    assert.deepEqual(context.previousAttempts, []);
    assert.equal(context.reflectionMemory, null);
    assertNoPrivateKeys(context, new Set(['answerKey', 'answerId', 'expected', 'definitions', 'instanceId', 'split', 'taskId', 'condition', 'variant', 'seed']));
  }
});

test('shared first attempts and assisted recovery remain separate with no evaluator context leakage', async () => {
  const actorContexts = [], analystContexts = [];
  const analyst = context => {
    analystContexts.push(clone(context));
    const failed = new Set(context.outcome.failures.map(failure => failure.id));
    return {
      summary: 'Reconstruct failed historical queries from completed public records.',
      recommendations: context.trajectory.filter(step => failed.has(step.checkpointId)).map(step => ({
        targetT: step.t,
        actionId: publicAnswer({ ...context, observation: step.observation, actions: step.actions,
          history: context.trajectory.filter(previous => previous.t < step.t) }),
        reasoning: 'Apply received evidence under the published effective-time rule.',
      })),
    };
  };
  const report = await runBenchmark({ attempts: 2, analysisBudget: 4,
    strategies: ['forward_only', 'trace_memory', 'reflection', 'temporal_pincer'] }, { policy: {
    decide(context) {
      actorContexts.push(clone(context));
      const correct = publicAnswer(context);
      const note = [...context.hints, ...(context.reflectionMemory?.recommendations ?? [])]
        .find(item => item.checkpointId === context.checkpointId);
      const assisted = note || context.previousAttempts.length > 0;
      const actionId = note?.actionId ?? (context.checkpointId === 'query_4' && !assisted
        ? context.actions.find(action => action.id !== correct).id : correct);
      return { actionId, reasoning: 'Deliberately fail the first query until completed-attempt assistance is available.' };
    },
    reflect: analyst, invert: analyst,
  } });
  const runs = report.cases[0].runs;
  assert.equal(actorContexts.filter(context => context.attempt === 1).length, 4, 'The source attempt must execute once across strategies');
  for (const run of runs) {
    assert.equal(run.metrics.firstAttemptSuccess, false);
    assert.equal(run.metrics.firstAttemptScore, 0.75);
    assert.deepEqual(run.attempts[0], runs[0].attempts[0]);
    assert.notEqual(run.attempts[0], runs.find(other => other !== run).attempts[0]);
    assert.equal(run.metrics.finalSuccess, run.strategy !== 'forward_only');
    assert.equal(run.metrics.recoveredAfterFailure, run.strategy !== 'forward_only');
  }
  assert.equal(report.costs.physicalPolicyDecisions, 20);
  assert.equal(report.costs.physicalAutomaticActions, 50);
  assert.equal(report.costs.modelUsage, null);
  assert.equal(analystContexts.length, 2);
  assert.deepEqual(analystContexts[0], analystContexts[1], 'Reflection and pincer receive the same complete observable evidence');
  for (const context of [...actorContexts, ...analystContexts]) {
    assertNoPrivateKeys(context, new Set(['answerKey', 'answerId', 'expected', 'definitions', 'instanceId', 'split', 'taskId', 'condition', 'variant', 'seed', 'decisionT']));
  }
  for (const context of actorContexts) {
    assert.ok(context.history.every(step => step.t < context.t));
    if (context.attempt === 1) {
      assert.deepEqual(context.hints, []);
      assert.deepEqual(context.previousAttempts, []);
      assert.equal(context.reflectionMemory, null);
      assert.equal(context.history.some(step => step.t >= context.t), false);
    }
    assert.ok(context.hints.every(hint => hint.sourceAttempt < context.attempt && hint.checkpointId === context.checkpointId));
  }
  const pincer = runs.find(run => run.strategy === 'temporal_pincer');
  assert.deepEqual(pincer.attempts[1].deliveries.map(delivery => delivery.t), [4]);
  assert.equal(pincer.analyses[0].candidateTests[0].accepted, true);
  assert.equal(pincer.analyses[0].replayActions, 14);
  assertNoPrivateKeys(report);
});

test('the focused validation matrix rejects altered factors and accidental paid-policy fallback', async () => {
  const defaults = validateValidationOptions({});
  assert.equal(defaults.attempts, 1);
  assert.equal(defaults.analysisBudget, 4);
  for (const options of [{ taskId: 'temporal_history' }, { variant: 'temporal_shift' }, { interference: 1 },
    { stateMode: 'updates' }, { delay: 0 }, { split: 'all' }, { seedCount: 11 }, { attempts: 3 },
    { policyKind: 'compatible', seedCount: 4 }]) assert.throws(() => validateValidationOptions(options));
  await assert.rejects(() => runValidation({ policyKind: 'compatible' }), /explicit policy/);
  await assert.rejects(() => runValidation({}, { policy: competentPolicy(), policyFactory: competentPolicy }), /not both/);
});
