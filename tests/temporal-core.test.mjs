import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPORAL_TASKS, createTemporalTask } from '../benchmark/temporal-tasks.mjs';

const clone = value => structuredClone(value);
const firstLineData = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

// This policy sees exactly a public brief, past observations, and the current
// query/options. It independently implements the rules, without the audit hook.
function publicLedgerPolicy(context) {
  if (context.actions.length === 1) return context.actions[0].id;
  const query = firstLineData(context.observation);
  const received = context.history.filter(step => step.observation.startsWith('Received record: '))
    .map(step => firstLineData(step.observation)).filter(record => record.receivedTime <= query.knowledgeTime);
  const cancelled = new Set(received.filter(record => record.type === 'retract').map(record => record.target));
  let selected;
  for (const record of received) {
    if (record.type !== 'assign' || cancelled.has(record.id) || record.effectiveTime > query.effectiveTime) continue;
    if (!selected || record.effectiveTime > selected.effectiveTime) selected = record;
  }
  const label = selected?.value ?? 'unknown';
  return context.actions.find(action => action.description === `Answer: ${label}`).id;
}

function execute(task, policy = publicLedgerPolicy) {
  const state = { spent: 0, choices: {} }, history = [], contexts = [];
  for (const definition of task.definitions) {
    const context = { ...clone(task.public), t: definition.t, checkpointId: definition.checkpointId,
      observation: definition.observation, actions: clone(definition.actions), history: clone(history) };
    contexts.push(context);
    const actionId = policy(context);
    const action = definition.actions.find(item => item.id === actionId);
    assert.ok(action, `Policy chose an unavailable action at ${definition.checkpointId}`);
    const result = task.transition(definition, action, state);
    history.push({ ...clone(definition), action: clone(action), result });
  }
  return { contexts, history, state, checks: task.score(state) };
}

test('focused registry contains two non-arithmetic temporal capabilities on separate public splits', () => {
  assert.deepEqual(TEMPORAL_TASKS.map(task => [task.id, task.family, task.split]), [
    ['temporal_history', 'temporal_state_tracking', 'development'],
    ['temporal_revision', 'temporal_state_tracking', 'evaluation'],
  ]);
  assert.ok(TEMPORAL_TASKS.every(task => task.capabilities.includes('effective_vs_received_time')));
});

test('a public-only policy solves every variant without planning, budget or arithmetic choices', () => {
  for (const metadata of TEMPORAL_TASKS) for (let seed = 0; seed < 20; seed++) for (const variant of ['base', 'temporal_shift']) {
    const task = createTemporalTask({ taskId: metadata.id, seed, variant, interference: seed % 4 });
    const run = execute(task);
    assert.equal(task.definitions.length, 14);
    assert.equal(run.checks.length, 4);
    assert.ok(run.checks.every(check => check.passed), `${metadata.id}/${seed}/${variant}`);
    assert.equal(task.public.effortBudget, null);
    assert.ok(task.definitions.flatMap(step => step.actions).every(action => action.cost === 0));
    assert.equal(task.definitions.filter(step => step.actions.length === 1).length, 10);
    assert.ok(task.definitions.filter(step => step.actions.length > 1).every(step => step.actions.some(action => action.id === 'unknown')));
  }
});

test('temporal variants change exactly one effective timestamp and flip a correct answer', () => {
  for (const metadata of TEMPORAL_TASKS) for (let seed = 0; seed < 20; seed++) {
    const base = createTemporalTask({ taskId: metadata.id, seed });
    const shifted = createTemporalTask({ taskId: metadata.id, seed, variant: 'temporal_shift' });
    assert.deepEqual(base.public, shifted.public);
    assert.deepEqual(base.definitions.map(step => [step.t, step.checkpointId, step.actions]), shifted.definitions.map(step => [step.t, step.checkpointId, step.actions]));
    let changed = 0;
    for (let i = 0; i < base.definitions.length; i++) {
      const left = base.definitions[i], right = shifted.definitions[i];
      if (left.observation === right.observation) continue;
      const a = firstLineData(left.observation), b = firstLineData(right.observation);
      assert.notEqual(a.effectiveTime, b.effectiveTime);
      delete a.effectiveTime; delete b.effectiveTime;
      assert.deepEqual(a, b, 'Non-temporal record facts must remain identical');
      assert.equal(left.observation.replace(/\d+/g, '#'), right.observation.replace(/\d+/g, '#'));
      changed++;
    }
    assert.equal(changed, 1);
    const leftKey = base.answerKey(), rightKey = shifted.answerKey();
    assert.equal(leftKey.filter((answer, i) => answer.answerId !== rightKey[i].answerId).length, 1);
    const run = execute(base);
    assert.equal(shifted.score(run.state).filter(check => !check.passed).length, 1,
      'The same non-temporal decision sequence must fail the changed temporal relation');
  }
});

test('uniform translation of both clocks preserves answers and action order', () => {
  for (const metadata of TEMPORAL_TASKS) for (const variant of ['base', 'temporal_shift']) for (const timeOffset of [-100, 100]) {
    const base = createTemporalTask({ taskId: metadata.id, seed: 42, variant });
    const translated = createTemporalTask({ taskId: metadata.id, seed: 42, variant, timeOffset });
    assert.deepEqual(base.answerKey(), translated.answerKey());
    assert.deepEqual(base.public, translated.public);
    assert.deepEqual(base.definitions.map(step => step.actions), translated.definitions.map(step => step.actions));
    for (let i = 0; i < base.definitions.length; i++) {
      const a = firstLineData(base.definitions[i].observation), b = firstLineData(translated.definitions[i].observation);
      for (const field of ['effectiveTime', 'receivedTime', 'knowledgeTime']) {
        if (field in a) { assert.equal(b[field], a[field] + timeOffset); delete a[field]; delete b[field]; }
      }
      assert.deepEqual(a, b);
    }
    assert.ok(execute(translated).checks.every(check => check.passed));
  }
});

test('the same historical question changes only as late evidence arrives or is retracted', () => {
  const task = createTemporalTask({ taskId: 'temporal_revision', seed: 42 });
  const queries = task.definitions.filter(step => step.actions.length > 1).map(step => firstLineData(step.observation));
  assert.equal(new Set(queries.map(query => query.effectiveTime)).size, 1);
  assert.deepEqual(queries.map(query => query.knowledgeTime), [4, 8, 11, 14]);
  const answers = task.answerKey().map(answer => answer.answerId);
  assert.notEqual(answers[0], answers[1], 'A late assignment must revise the known past');
  assert.equal(answers[0], answers[2], 'Retracting that assignment must restore the earlier known past');
  assert.notEqual(answers[2], answers[3], 'A subsequent retraction must revise the same historical answer again');
});

test('future records and evaluator keys never enter public contexts or answer feedback', () => {
  for (const metadata of TEMPORAL_TASKS) {
    const task = createTemporalTask({ taskId: metadata.id, seed: 42 });
    const run = execute(task);
    for (const context of run.contexts) {
      const serialized = JSON.stringify(context);
      for (const privateName of ['answerKey', 'answerId', 'instanceId', 'definitions', 'capabilities', 'split']) assert.equal(serialized.includes(`\"${privateName}\"`), false);
      const visible = context.history.filter(step => step.observation.startsWith('Received record: ')).map(step => firstLineData(step.observation));
      assert.ok(visible.every(record => record.receivedTime < context.t));
      assert.equal(context.history.some(step => step.t >= context.t), false);
    }
    assert.ok(run.history.filter(step => step.actions.length > 1).every(step => !/correct|incorrect|expected/i.test(step.result)));
    assert.ok(run.checks.every(check => !('answerId' in check) && !('expected' in check)));
  }
  const history = createTemporalTask({ taskId: 'temporal_history', seed: 42 });
  assert.equal(history.answerKey()[0].answerId, 'unknown', 'An unreceived backdated record must not fill the first query');
  const run = execute(history);
  const firstQuery = run.contexts.find(context => context.checkpointId === 'query_4');
  assert.equal(firstQuery.history.some(step => step.observation.includes('"id":"h6"')), false);
});

test('interference preserves semantics and all choices while labels are not position-coded', () => {
  const firstAnswerPositions = new Set();
  for (const metadata of TEMPORAL_TASKS) for (let seed = 0; seed < 20; seed++) {
    const clean = createTemporalTask({ taskId: metadata.id, seed });
    const cluttered = createTemporalTask({ taskId: metadata.id, seed, interference: 3 });
    assert.deepEqual(clean.public, cluttered.public);
    assert.deepEqual(clean.answerKey(), cluttered.answerKey());
    assert.deepEqual(clean.definitions.map(step => step.actions), cluttered.definitions.map(step => step.actions));
    for (let i = 0; i < clean.definitions.length; i++) {
      const a = clean.definitions[i], b = cluttered.definitions[i];
      assert.equal(b.observation.split('\n').filter(line => line.startsWith('Unrelated maintenance')).length, a.actions.length === 1 ? 3 : 0);
      assert.equal(b.observation.split('\n')[0], a.observation.split('\n')[0]);
    }
    const firstQuery = clean.definitions.find(step => step.actions.length > 1);
    firstAnswerPositions.add(firstQuery.actions.findIndex(action => action.id === clean.answerKey()[0].answerId));
  }
  assert.ok(firstAnswerPositions.size > 1, 'The correct label must not occupy a fixed option position');
});

test('task construction and scoring are reproducible and audit keys are independent copies', () => {
  for (const metadata of TEMPORAL_TASKS) {
    const options = { taskId: metadata.id, seed: 42, variant: 'temporal_shift', interference: 2 };
    const a = createTemporalTask(options), b = createTemporalTask(options);
    assert.deepEqual(a.public, b.public);
    assert.deepEqual(a.definitions, b.definitions);
    assert.equal(a.instanceId, b.instanceId);
    assert.deepEqual(execute(a).checks, execute(b).checks);
    const key = a.answerKey(); key[0].answerId = 'tampered';
    assert.notEqual(a.answerKey()[0].answerId, 'tampered');
  }
  assert.throws(() => createTemporalTask({ taskId: 'temporal_history', seed: 42, stateMode: 'updates' }), /temporal state/);
  assert.throws(() => createTemporalTask({ taskId: 'temporal_history', seed: 42, variant: 'unknown' }), /variant/);
});
