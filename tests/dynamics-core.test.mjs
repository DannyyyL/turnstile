import test from 'node:test';
import assert from 'node:assert/strict';
import { DYNAMICS_TASKS, createDynamicsTask, auditDynamicsPair } from '../benchmark/dynamics-tasks.mjs';
import { simulateDynamics, consistentDynamics, predictDynamics, createDynamicsReferencePolicy } from '../benchmark/dynamics-policy.mjs';

const clone = value => structuredClone(value);
const data = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

// Independently implemented public semantics. The tests never provide a seed,
// task closure, answer key or actual mechanism to this policy in infer mode.
function independentState(rule, run, horizon) {
  let armedAt = null;
  for (const input of run.inputs.filter(input => input.time <= horizon)) {
    if (armedAt !== null && armedAt + rule.delay <= input.time) return 'committed';
    if (input.type === 'cancel') armedAt = null;
    else if (armedAt === null || rule.retrigger === 'restart') armedAt = input.time;
  }
  if (armedAt === null) return 'idle';
  return armedAt + rule.delay <= horizon ? 'committed' : 'pending';
}
function inferPublic(context) {
  const runs = context.history.filter(step => step.observation.startsWith('Observed run: ')).map(step => data(step.observation));
  return (context.providedMechanism ? [context.providedMechanism] : context.candidateMechanisms).filter(rule =>
    runs.every(run => run.observations.every(snapshot => independentState(rule, run, snapshot.time) === snapshot.state)));
}
function publicPolicy(context) {
  if (context.actions.length === 1) return { actionId: context.actions[0].id, reasoning: 'Record calibration.' };
  const query = data(context.observation), mechanisms = inferPublic(context);
  assert.ok(mechanisms.length, 'Visible calibration must admit a mechanism');
  const possible = new Set(mechanisms.map(rule => independentState(rule, query, query.horizon)));
  return { actionId: possible.size === 1 ? [...possible][0] : 'underdetermined', reasoning: 'Forecast from all mechanisms fitting observed runs.' };
}
function execute(task, policy = publicPolicy) {
  const state = { spent: 0, choices: {} }, history = [], contexts = [];
  for (const definition of task.definitions) {
    const context = { ...clone(task.public), t: definition.t, checkpointId: definition.checkpointId,
      observation: definition.observation, actions: clone(definition.actions), history: clone(history) };
    contexts.push(context);
    const response = policy(context), action = definition.actions.find(item => item.id === response.actionId);
    assert.ok(action, `Unavailable policy action at ${definition.checkpointId}`);
    const result = task.transition(definition, action, state);
    history.push({ ...clone(definition), action: clone(action), result });
  }
  return { state, history, contexts, checks: task.score(state) };
}
function assertNoPrivateKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(['answerKey', 'answerId', 'learningAudit', 'instanceId', 'seed', 'selectedMechanism', 'expected', 'definitions'].includes(key), false, `Leaked evaluator key ${key}`);
    assertNoPrivateKeys(child);
  }
}

test('dynamics registry is one explicit public development task, not a fabricated held-out split', () => {
  assert.deepEqual(DYNAMICS_TASKS.map(task => [task.id, task.family, task.suite, task.split]), [
    ['delayed_commit', 'dynamics_learning', 'dynamics', 'development'],
  ]);
});

test('three observed runs identify diverse dynamics and a public-only solver predicts a novel run', () => {
  const mechanisms = new Set(), calibrationSchedules = new Set();
  for (let seed = 0; seed < 60; seed++) for (const variant of ['base', 'temporal_shift']) for (const ruleAccess of ['infer', 'given']) {
    const task = createDynamicsTask({ seed, variant, ruleAccess, interference: seed % 4 });
    const run = execute(task);
    assert.ok(run.checks.every(check => check.passed), `Failed ${seed}/${variant}/${ruleAccess}`);
    assert.equal(run.checks.length, 6);
    assert.equal(task.definitions.length, 9);
    assert.equal(task.definitions.filter(step => step.phase === 'calibration' && step.actions.length === 1).length, 3);
    assert.equal(task.definitions.filter(step => step.phase === 'forecast' && step.actions.length === 4).length, 6);
    assert.equal(task.public.effortBudget, null);
    const firstForecast = run.contexts.find(context => context.checkpointId === 'forecast_1');
    const identified = inferPublic({ ...firstForecast, providedMechanism: null });
    assert.equal(identified.length, 1);
    mechanisms.add(JSON.stringify(identified[0]));
    const calibrations = firstForecast.history.map(step => data(step.observation));
    calibrationSchedules.add(JSON.stringify(calibrations.map(episode => episode.inputs.map(input => [input.type, input.time - episode.startTime]))));
    const futureInputs = data(firstForecast.observation).inputs.map(input => input.type);
    assert.ok(calibrations.every(episode => JSON.stringify(episode.inputs.map(input => input.type)) !== JSON.stringify(futureInputs)));
    assert.deepEqual(task.learningAudit(), { calibrationRuns: 3, forecastQueries: 6, consistentMechanisms: 1, targetScheduleNovel: true });
    if (ruleAccess === 'infer') assert.equal(task.public.providedMechanism, null);
    else assert.deepEqual(task.public.providedMechanism, identified[0]);
  }
  assert.equal(mechanisms.size, 6, 'Seeds must vary the actual dynamics, not only labels or option positions');
  assert.ok(calibrationSchedules.size > 1, 'Calibration input timing must also vary across instances');
});

test('future predictions require both delay and retriggering in both temporal variants', () => {
  for (const variant of ['base', 'temporal_shift']) {
    const task = createDynamicsTask({ seed: 42, variant });
    const queries = task.definitions.filter(step => step.phase === 'forecast').map(step => data(step.observation));
    const signatures = task.public.candidateMechanisms.map(rule => queries.map(query => independentState(rule, query, query.horizon)).join(','));
    assert.equal(new Set(signatures).size, 6, 'Every candidate mechanism must imply a different scored forecast vector');
    for (const delay of [2, 4, 6]) {
      const patterns = task.public.candidateMechanisms.map((rule, i) => ({ rule, signature: signatures[i] })).filter(item => item.rule.delay === delay);
      assert.notEqual(patterns[0].signature, patterns[1].signature, `Retriggering must matter at delay ${delay}`);
    }
  }
});

test('timestamp-only contrast flips a forecast without changing calibration, inputs or options', () => {
  for (let seed = 0; seed < 60; seed++) {
    const a = createDynamicsTask({ seed }), b = createDynamicsTask({ seed, variant: 'temporal_shift' });
    assert.deepEqual(a.public, b.public);
    assert.deepEqual(a.definitions.map(step => [step.t, step.checkpointId, step.phase, step.actions]), b.definitions.map(step => [step.t, step.checkpointId, step.phase, step.actions]));
    const changed = a.definitions.filter((step, i) => step.observation !== b.definitions[i].observation);
    assert.deepEqual(changed.map(step => step.checkpointId), ['forecast_1']);
    const first = data(changed[0].observation), other = data(b.definitions[3].observation);
    assert.equal(first.horizon, 25); assert.equal(other.horizon, 32);
    delete first.horizon; delete other.horizon;
    assert.deepEqual(first, other);
    const audit = auditDynamicsPair(a, b);
    assert.equal(audit.changedQueryCount, 1);
    assert.deepEqual(audit.changedCheckpoints, ['forecast_1']);
    assert.deepEqual(audit.changedTimestampFields, [{ checkpointId: 'forecast_1', field: 'horizon' }]);
    assertNoPrivateKeys(audit);
    assert.equal(b.score(execute(a).state).filter(check => !check.passed).length, 1);
  }
});

test('the mechanism-supplied control preserves observations and all prediction answers', () => {
  for (let seed = 0; seed < 20; seed++) {
    const infer = createDynamicsTask({ seed }), given = createDynamicsTask({ seed, ruleAccess: 'given' });
    assert.deepEqual(infer.definitions, given.definitions);
    assert.deepEqual(infer.answerKey(), given.answerKey());
    const { ruleAccess: modeA, providedMechanism: mechanismA, ...briefA } = infer.public;
    const { ruleAccess: modeB, providedMechanism: mechanismB, ...briefB } = given.public;
    assert.equal(modeA, 'infer'); assert.equal(modeB, 'given');
    assert.equal(mechanismA, null); assert.ok(mechanismB);
    assert.deepEqual(briefA, briefB);
    assert.ok(execute(given).checks.every(check => check.passed));
  }
});

test('all forecast outcomes are withheld until the complete frozen prediction batch is scored', () => {
  for (const variant of ['base', 'temporal_shift']) {
    const task = createDynamicsTask({ seed: 42, variant }), run = execute(task);
    const contexts = run.contexts.filter(context => context.checkpointId.startsWith('forecast_'));
    const issueTimes = new Set();
    for (const context of contexts) {
      assertNoPrivateKeys(context);
      assert.equal(context.providedMechanism, null);
      const query = data(context.observation);
      issueTimes.add(query.issueTime);
      assert.ok(query.horizon > query.issueTime);
      assert.equal('observations' in query, false);
      assert.equal('state' in query, false);
      assert.ok(context.history.every(step => step.t < context.t));
      for (const step of context.history) {
        if (step.phase === 'calibration') assert.ok(data(step.observation).observations.every(snapshot => snapshot.time < query.issueTime));
        else {
          assert.equal('observations' in data(step.observation), false);
          assert.equal(/was correct|was incorrect|actual state|expected answer/i.test(step.result), false);
          assert.equal(step.result, 'Prediction frozen.');
        }
      }
    }
    assert.equal(issueTimes.size, 1, 'Forecast decisions must not advance the world or reveal outcomes');
    assert.ok(run.checks.every(check => check.detectedAt === 9));
    assertNoPrivateKeys(run.checks);
  }
});

test('clock translation and irrelevant maintenance preserve learned dynamics and predictions', () => {
  for (const variant of ['base', 'temporal_shift']) for (const timeOffset of [-100, 100]) {
    const base = createDynamicsTask({ seed: 42, variant });
    const translated = createDynamicsTask({ seed: 42, variant, timeOffset });
    const distracted = createDynamicsTask({ seed: 42, variant, interference: 3 });
    assert.deepEqual(base.public, translated.public);
    assert.deepEqual(base.public, distracted.public);
    assert.deepEqual(base.answerKey(), translated.answerKey());
    assert.deepEqual(base.answerKey(), distracted.answerKey());
    assert.deepEqual(base.definitions.map(step => step.actions), translated.definitions.map(step => step.actions));
    for (let i = 0; i < base.definitions.length; i++) {
      const a = data(base.definitions[i].observation), b = data(translated.definitions[i].observation);
      assert.equal(b.startTime, a.startTime + timeOffset);
      assert.deepEqual(b.inputs, a.inputs.map(input => ({ ...input, time: input.time + timeOffset })));
      if (a.observations) assert.deepEqual(b.observations, a.observations.map(snapshot => ({ ...snapshot, time: snapshot.time + timeOffset })));
      else { assert.equal(b.issueTime, a.issueTime + timeOffset); assert.equal(b.horizon, a.horizon + timeOffset); }
      assert.equal(distracted.definitions[i].observation.split('\n')[0], base.definitions[i].observation.split('\n')[0]);
      assert.equal(distracted.definitions[i].observation.split('\n').filter(line => line.startsWith('Unrelated maintenance')).length, i < 3 ? 3 : 0);
    }
    assert.ok(execute(translated).checks.every(check => check.passed));
    assert.ok(execute(distracted).checks.every(check => check.passed));
  }
});

test('boundary semantics distinguish commit ties, input order, cancellation and retriggering', () => {
  const run = inputs => ({ startTime: 0, initialState: 'idle', inputs: inputs.map(([time, type]) => ({ time, type })) });
  const restart = { delay: 2, retrigger: 'restart' }, ignore = { delay: 2, retrigger: 'ignore' };
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [2, 'cancel']]), 2), 'committed', 'Commit wins the tie with cancellation');
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [1, 'cancel']]), 8), 'idle');
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [1, 'arm']]), 2), 'pending');
  assert.equal(simulateDynamics(ignore, run([[0, 'arm'], [1, 'arm']]), 2), 'committed');
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [1, 'cancel'], [1, 'arm']]), 1), 'pending');
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [1, 'arm'], [1, 'cancel']]), 1), 'idle');
  assert.equal(simulateDynamics(restart, run([[0, 'arm'], [2, 'arm'], [3, 'cancel']]), 20), 'committed', 'Committed cannot be restarted or canceled');
  assert.equal(simulateDynamics(restart, run([[5, 'arm']]), 3), 'idle', 'Known future inputs must not apply before their times');
});

test('ambiguous calibration yields underdetermination only when predictions disagree', () => {
  const task = createDynamicsTask({ seed: 42 });
  const run = { startTime: 0, initialState: 'idle', inputs: [{ time: 0, type: 'arm' }] };
  const possible = consistentDynamics([{ ...run, observations: [{ time: 1, state: 'pending' }] }], task.public.candidateMechanisms);
  assert.equal(possible.length, 6);
  assert.equal(predictDynamics(possible, run, 1), 'pending');
  assert.equal(predictDynamics(possible, run, 3), 'underdetermined');
  assert.equal(predictDynamics(possible, run, 8), 'committed');
  const context = { ...task.public, history: [{ observation: `Observed run: ${JSON.stringify({ ...run, observations: [{ time: 1, state: 'pending' }] })}` }],
    observation: `Forecast query: ${JSON.stringify({ ...run, issueTime: 0, horizon: 3 })}`, actions: task.definitions[3].actions };
  assert.equal(createDynamicsReferencePolicy().decide(context).actionId, 'underdetermined');
  assert.throws(() => predictDynamics([], run, 3), /No mechanism/);
});

test('public exact reference agrees with independent solver and construction is reproducible', () => {
  const policy = createDynamicsReferencePolicy();
  for (let seed = 0; seed < 20; seed++) {
    const task = createDynamicsTask({ seed });
    assert.deepEqual(execute(task, context => policy.decide(context)).checks, execute(task).checks);
  }
  const a = createDynamicsTask({ seed: 42, interference: 2 }), b = createDynamicsTask({ seed: 42, interference: 2 });
  assert.equal(a.instanceId, b.instanceId);
  assert.deepEqual(a.public, b.public);
  assert.deepEqual(a.definitions, b.definitions);
  assert.deepEqual(a.answerKey(), b.answerKey());
  const key = a.answerKey(); key[0].answerId = 'tampered';
  assert.notEqual(a.answerKey()[0].answerId, 'tampered');
  assert.throws(() => createDynamicsTask({ seed: 42, ruleAccess: 'answer_key' }), /ruleAccess/);
  assert.throws(() => createDynamicsTask({ seed: 42, variant: 'unknown' }), /variant/);
});
