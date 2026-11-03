import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTask, runBenchmark, validateBenchmarkOptions } from '../benchmark/index.mjs';
import { runValidation } from '../benchmark/validation.mjs';

const TASK_ID = 'delayed_commit';
const parsed = (observation, prefix) => JSON.parse(observation.split('\n')[0].slice(prefix.length));
const calibrationRuns = history => history.filter(step => step.observation.startsWith('Observed run: '))
  .map(step => parsed(step.observation, 'Observed run: '));
const forecast = observation => parsed(observation, 'Forecast query: ');
const key = mechanism => `${mechanism.delay}:${mechanism.retrigger}`;

// Independent implementation of the published machine. Do not import the
// evaluator simulator, answer closures, or the production reference solver.
function stateAt(run, mechanism, horizon) {
  assert.equal(run.initialState, 'idle');
  let state = 'idle', due = null;
  const inputs = run.inputs.map((input, index) => ({ ...input, index }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  for (const input of inputs) {
    if (input.time > horizon) break;
    if (due !== null && due <= input.time) { state = 'committed'; due = null; }
    if (state === 'committed') continue;
    if (input.type === 'cancel') { state = 'idle'; due = null; }
    else if (input.type === 'arm') {
      if (state === 'idle' || mechanism.retrigger === 'restart') due = input.time + mechanism.delay;
      state = 'pending';
    } else assert.fail(`Unexpected public input ${input.type}`);
  }
  if (due !== null && due <= horizon) state = 'committed';
  return state;
}

function consistent(candidates, runs) {
  return candidates.filter(mechanism => runs.every(run => run.observations.every(observation =>
    stateAt(run, mechanism, observation.time) === observation.state)));
}

function publicPrediction(context, { ignoreCalibration = false } = {}) {
  const candidates = context.providedMechanism ? [context.providedMechanism]
    : consistent(context.candidateMechanisms, ignoreCalibration ? [] : calibrationRuns(context.history));
  assert.ok(candidates.length > 0, 'Published calibration data must fit at least one published mechanism.');
  const query = forecast(context.observation);
  const answers = new Set(candidates.map(mechanism => stateAt(query, mechanism, query.horizon)));
  return { actionId: answers.size === 1 ? [...answers][0] : 'underdetermined', reasoning: '' };
}

function representativeSeeds() {
  const examples = new Map();
  for (let seed = 0; seed < 256 && examples.size < 6; seed++) {
    const task = createTask({ taskId: TASK_ID, seed, ruleAccess: 'given' });
    const mechanism = task.public.providedMechanism;
    assert.ok(mechanism, 'The given-rule control must explicitly provide its mechanism.');
    if (!examples.has(key(mechanism))) examples.set(key(mechanism), { seed, mechanism });
  }
  assert.equal(examples.size, 6, 'Exercise every mechanism, rather than one convenient environment seed.');
  return [...examples.values()];
}

const onlyAttempt = report => report.cases[0].runs[0].attempts[0];

test('dynamics is the default first-attempt-only task and rejects same-instance recovery', () => {
  const defaults = validateBenchmarkOptions({});
  assert.equal(defaults.suite, 'dynamics');
  assert.equal(defaults.ruleAccess, 'infer');
  assert.equal(defaults.attempts, 1);
  assert.deepEqual(defaults.strategies, ['forward_only']);
  assert.equal(validateBenchmarkOptions({ taskId: TASK_ID }).suite, 'dynamics');
  for (const options of [{ attempts: 2 }, { strategies: ['reflection'] }, { strategies: ['trace_memory'] },
    { strategies: ['temporal_pincer'] }, { ruleAccess: 'missing' }, { rulesAccess: 'given' }, { split: 'evaluation' }]) {
    assert.throws(() => validateBenchmarkOptions({ suite: 'dynamics', ...options }));
  }
  const historical = validateBenchmarkOptions({ suite: 'temporal', attempts: 2, strategies: ['reflection', 'temporal_pincer'] });
  assert.equal(historical.attempts, 2);
});

test('public calibration identifies all six mechanisms and forecasts depend on both dynamics factors', () => {
  let commonPublicRules;
  for (const { seed } of representativeSeeds()) for (const variant of ['base', 'temporal_shift']) {
    const task = createTask({ taskId: TASK_ID, seed, variant, ruleAccess: 'infer' });
    assert.equal(task.public.taskType, 'dynamics_learning');
    assert.equal(task.public.providedMechanism ?? null, null);
    commonPublicRules ??= task.public;
    assert.deepEqual(task.public, commonPublicRules, 'Infer-mode public metadata must not disclose which mechanism generated calibration.');
    const candidates = task.public.candidateMechanisms;
    assert.equal(candidates.length, 6);
    assert.equal(new Set(candidates.map(key)).size, 6);
    const runs = calibrationRuns(task.definitions);
    assert.equal(runs.length, 3);
    assert.equal(consistent(candidates, []).length, 6, 'Without observations, the selected mechanism is not identified.');
    assert.equal(consistent(candidates, runs).length, 1, 'Calibration must identify the mechanism from public evidence.');
    const queries = task.definitions.filter(step => step.observation.startsWith('Forecast query: ')).map(step => forecast(step.observation));
    assert.equal(queries.length, 6);
    const vectors = candidates.map(mechanism => queries.map(query => stateAt(query, mechanism, query.horizon)));
    assert.equal(new Set(vectors.map(vector => JSON.stringify(vector))).size, 6,
      'Distinct learned mechanisms must produce distinguishable scored predictions, not just distinct calibration traces.');
    for (const query of queries) {
      assert.equal(query.issueTime, query.startTime);
      assert.ok(query.horizon > query.issueTime);
      assert.ok(!Object.hasOwn(query, 'observations'), 'Future outcomes must not be supplied with the forecast input.');
      assert.ok(runs.every(run => JSON.stringify(run.inputs.map(input => [input.time - run.startTime, input.type]))
        !== JSON.stringify(query.inputs.map(input => [input.time - query.startTime, input.type]))), 'Forecast input composition must be unseen in calibration.');
    }
    const ambiguous = queries.filter(query => new Set(candidates.map(mechanism => stateAt(query, mechanism, query.horizon))).size > 1);
    assert.equal(ambiguous.length, 5, 'Five boundary forecasts require identifying the mechanism; the timing-control forecast is deliberately common.');
  }
});

test('an independent public-evidence learner succeeds without explanations or future feedback', async () => {
  for (const { seed } of representativeSeeds()) for (const variant of ['base', 'temporal_shift']) for (const ruleAccess of ['infer', 'given']) {
    const contexts = [];
    const report = await runBenchmark({ taskId: TASK_ID, seed, variant, ruleAccess, policyKind: 'custom' }, {
      policy: { async decide(context) { contexts.push(structuredClone(context)); return publicPrediction(context); } },
    });
    const attempt = onlyAttempt(report);
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.benchmarkVersion, '0.5.0');
    assert.equal(report.status, 'completed');
    assert.equal(report.cases[0].family, 'dynamics_learning');
    assert.equal(attempt.score, 1);
    assert.equal(attempt.outcome.total, 6, 'Only future forecasts count toward the score.');
    assert.ok(attempt.outcome.checks.every(check => check.id.startsWith('forecast_')));
    assert.equal(attempt.automaticActions, 3);
    assert.equal(attempt.policyDecisions, 6);
    assert.equal(contexts.length, 6);
    assert.ok(attempt.steps.filter(step => step.execution === 'policy').every(step => step.reasoning === ''));
    for (const context of contexts) {
      assert.equal(context.attempt, 1);
      assert.deepEqual(context.hints, []);
      assert.equal(context.reflectionMemory, null);
      assert.deepEqual(context.previousAttempts, []);
      assert.equal(calibrationRuns(context.history).length, 3);
      assert.equal(context.providedMechanism != null, ruleAccess === 'given');
      for (const field of ['seed', 'taskId', 'answerKey', 'expectedAnswers', 'hiddenMechanism', 'selectedMechanism', 'definitions']) {
        assert.ok(!Object.hasOwn(context, field), `Actor context must not expose ${field}.`);
      }
      for (const step of context.history.filter(step => step.checkpointId.startsWith('forecast_'))) {
        assert.ok(!Object.hasOwn(step, 'outcome'));
        assert.match(step.result, /Prediction frozen/);
        assert.doesNotMatch(step.result, /\b(?:idle|pending|committed|underdetermined)\b|"(?:state|passed|success)"\s*:/i,
          'Earlier predictions must not reveal forecast outcomes before remaining predictions are frozen.');
      }
    }
    assert.equal(report.cases[0].runs.length, 1);
    assert.equal(report.cases[0].runs[0].attempts.length, 1);
    assert.equal(report.cases[0].runs[0].metrics.recoveryEligible, false);
    assert.equal(report.cases[0].runs[0].analyses.length, 0);
  }
});

test('removing calibration from the public learner loses the five mechanism-dependent forecasts', async () => {
  for (const { seed } of representativeSeeds()) for (const variant of ['base', 'temporal_shift']) {
    const report = await runBenchmark({ taskId: TASK_ID, seed, variant, ruleAccess: 'infer', policyKind: 'custom' }, {
      policy: { decide: async context => publicPrediction(context, { ignoreCalibration: true }) },
    });
    const attempt = onlyAttempt(report);
    assert.equal(attempt.score, 1 / 6);
    assert.equal(attempt.outcome.passed, 1);
    const predictions = attempt.steps.filter(step => step.execution === 'policy');
    assert.equal(predictions.filter(step => step.action.id === 'underdetermined').length, 5);
  }
});

test('irrelevant maintenance observations preserve the calibration and all future predictions', async () => {
  for (const { seed } of representativeSeeds()) for (const variant of ['base', 'temporal_shift']) {
    const clean = createTask({ taskId: TASK_ID, seed, variant, interference: 0 });
    const noisy = createTask({ taskId: TASK_ID, seed, variant, interference: 3 });
    assert.deepEqual(noisy.public, clean.public);
    assert.deepEqual(noisy.definitions.map(step => step.observation.split('\n')[0]), clean.definitions.map(step => step.observation.split('\n')[0]));
    assert.deepEqual(noisy.definitions.map(step => step.actions), clean.definitions.map(step => step.actions));
    const report = await runBenchmark({ taskId: TASK_ID, seed, variant, interference: 3, policyKind: 'custom' }, {
      policy: { decide: async context => publicPrediction(context) },
    });
    assert.equal(onlyAttempt(report).score, 1);
    assert.equal(report.costs.physicalPolicyDecisions, 6);
  }
});

test('matched validation separates inference from supplied rules and retains exact future scoring', async () => {
  const report = await runValidation({ policyKind: 'custom' }, { policy: { decide: async context => publicPrediction(context) } });
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.conditions.map(condition => condition.id), ['base_infer', 'shifted_infer', 'base_given', 'shifted_given']);
  assert.equal(report.conditions.length, 4);
  for (const condition of report.conditions) {
    assert.equal(onlyAttempt(condition.report).score, 1);
    assert.equal(condition.report.options.attempts, 1);
    assert.deepEqual(condition.report.options.strategies, ['forward_only']);
    assert.equal(condition.report.options.ruleAccess, condition.id.endsWith('given') ? 'given' : 'infer');
  }
  assert.equal(report.costs.physicalPolicyDecisions, 24);
  assert.equal(report.costs.physicalAutomaticActions, 12);
});

test('partial forecast failures retain null paired metrics and explicit error coverage', async () => {
  const report = await runValidation({ policyKind: 'custom' }, {
    policyFactory: ({ condition }) => ({
      async decide(context) {
        if (condition.id === 'shifted_infer' && context.checkpointId === 'forecast_3') throw new Error('Deliberate test interruption.');
        return publicPrediction(context);
      },
    }),
  });
  assert.equal(report.status, 'completed_with_errors');
  const failed = report.conditions.find(condition => condition.id === 'shifted_infer');
  assert.equal(failed.report.status, 'completed_with_errors');
  const attempt = onlyAttempt(failed.report);
  assert.equal(attempt.status, 'error');
  assert.equal(attempt.score, null);
  assert.equal(attempt.outcome, null);
  assert.equal(attempt.steps.filter(step => step.execution === 'policy').length, 2);
  for (const id of ['timing_infer', 'supplied_rules_shifted']) {
    const pair = report.pairs.find(pair => pair.id === id);
    const row = pair.caseDeltas[0], summary = pair.summary[0];
    assert.equal(row.firstComplete, false);
    assert.equal(row.finalComplete, false);
    assert.equal(row.firstAttemptScoreDelta, null);
    assert.equal(row.firstAttemptSuccessDelta, null);
    assert.equal(row.finalScoreDelta, null);
    assert.equal(row.finalSuccessDelta, null);
    assert.equal(row.pairedTemporalAccuracy, null);
    assert.equal(summary.pairedCases, 1);
    assert.equal(summary.completeFirstPairs, 0);
    assert.equal(summary.incompleteFirstPairs, 1);
    assert.equal(summary.completeFinalPairs, 0);
    assert.equal(summary.incompleteFinalPairs, 1);
    assert.equal(summary.controlErrors + summary.treatmentErrors, 1);
    assert.equal(summary.pairedTemporalAccuracy, null);
  }
  const completedTiming = report.pairs.find(pair => pair.id === 'timing_given');
  assert.equal(completedTiming.caseDeltas[0].pairedTemporalAccuracy, 1);
  assert.equal(completedTiming.summary[0].completeFirstPairs, 1);
  assert.equal(completedTiming.summary[0].incompleteFirstPairs, 0);
  assert.equal(completedTiming.summary[0].controlErrors + completedTiming.summary[0].treatmentErrors, 0);
  assert.equal(report.conditions.find(condition => condition.id === 'base_given').report.status, 'completed');
  assert.equal(report.conditions.find(condition => condition.id === 'shifted_given').report.status, 'completed');
});

test('dynamics reports reproduce exactly with fixed options and hash their complete content', async () => {
  const report = await runBenchmark({ taskId: TASK_ID, ruleAccess: 'infer', variant: 'temporal_shift', seed: 42 });
  assert.deepEqual(await runBenchmark(report.options), report);
  const { reportHash, ...body } = report;
  assert.equal(reportHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
});
