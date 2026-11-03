import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_TASKS as TASKS, createTask } from '../benchmark/tasks.mjs';

function execute(task, choose) {
  const state = { spent: 0, choices: {} }, history = [];
  for (const definition of task.definitions) {
    const id = choose(definition, history, task.public);
    const action = definition.actions.find(a => a.id === id);
    assert.ok(action, `Unavailable test-policy action ${id} at ${definition.checkpointId}`);
    const result = task.transition(definition, action, state);
    history.push({ ...definition, action, result });
  }
  return { state, history, checks: task.score(state) };
}
const firstChoice = d => d.actions[0].id;
const eventFrom = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

test('maintenance interference changes observations without changing choices, horizon, costs or answers', () => {
  for (const metadata of TASKS) for (const stateMode of ['updates', 'temporal']) {
    const base = createTask({ taskId: metadata.id, seed: 42, stateMode });
    const cluttered = createTask({ taskId: metadata.id, seed: 42, stateMode, interference: 3 });
    assert.equal(base.definitions.length, 14);
    assert.deepEqual(base.public, cluttered.public);
    assert.deepEqual(base.definitions.map(d => [d.t, d.checkpointId, d.actions]), cluttered.definitions.map(d => [d.t, d.checkpointId, d.actions]));
    for (let i = 0; i < base.definitions.length; i++) {
      if (base.definitions[i].actions.length > 1) assert.equal(base.definitions[i].observation, cluttered.definitions[i].observation);
      else assert.equal(cluttered.definitions[i].observation.split('\n').filter(line => line.startsWith('Unrelated maintenance channel')).length, 3);
    }
    const a = execute(base, firstChoice), b = execute(cluttered, firstChoice);
    assert.equal(a.state.spent, b.state.spent);
    assert.deepEqual(a.history.map(s => s.action.id), b.history.map(s => s.action.id));
    assert.deepEqual(a.checks, b.checks);
    assert.notEqual(base.instanceId, cluttered.instanceId);
  }
});

test('updates control removes retraction and expiry while retaining event timing and option order', () => {
  for (const taskId of ['state_ledger', 'state_access']) for (let seed = 0; seed < 6; seed++) {
    const temporal = createTask({ taskId, seed }), updates = createTask({ taskId, seed, stateMode: 'updates' });
    assert.deepEqual(temporal.definitions.map(d => [d.t, d.checkpointId, d.actions]), updates.definitions.map(d => [d.t, d.checkpointId, d.actions]));
    const temporalEvents = temporal.definitions.filter(d => d.actions.length === 1).map(d => eventFrom(d.observation));
    const updateEvents = updates.definitions.filter(d => d.actions.length === 1).map(d => eventFrom(d.observation));
    assert.deepEqual(temporalEvents.map(e => [e.id, e.arrival, e.effective]), updateEvents.map(e => [e.id, e.arrival, e.effective]));
    assert.ok(updateEvents.filter(e => e.type === 'assign').every(e => e.until === null));
    assert.equal(updateEvents.filter(e => e.type === 'note').length, 3);
    const value = id => temporalEvents.find(e => e.id === id).value;
    const answer = (mode, definition) => {
      if (definition.actions.length === 1) return definition.actions[0].id;
      if (mode === 'updates') return value(definition.t === 6 ? 'e2' : definition.t === 10 ? 'e5' : 'e7');
      const queryTime = Number(/effective time (\d+)/.exec(definition.observation)[1]);
      return definition.t === 6 ? value('e4') : definition.t === 10 || queryTime >= 11 ? 'none' : value('e7');
    };
    assert.ok(execute(temporal, d => answer('temporal', d)).checks.every(c => c.passed));
    assert.ok(execute(updates, d => answer('updates', d)).checks.every(c => c.passed));
    const stale = execute(temporal, d => answer('updates', d));
    assert.equal(stale.checks[0].passed, false, 'Ignoring retraction must fail the first temporal query');
    assert.equal(stale.checks[1].passed, false, 'Ignoring expiry must fail the boundary query');
  }
});

test('evaluation split has genuinely distinct plan and state structures, with no split metadata in prompts', () => {
  const evaluation = TASKS.filter(t => t.split === 'evaluation');
  assert.deepEqual(evaluation.map(t => t.id), ['temporal_pipeline', 'state_reservations']);
  assert.equal(TASKS.filter(t => t.split === 'development').length, 4);
  for (const metadata of TASKS) {
    const task = createTask({ taskId: metadata.id, seed: 42, interference: 2 });
    for (const key of ['taskId', 'seed', 'split', 'answers', 'definitions', 'instanceId']) assert.ok(!Object.hasOwn(task.public, key));
    const visible = JSON.stringify([task.public, task.definitions]);
    assert.ok(!visible.includes('answerKey'));
    assert.ok(!visible.includes('"split"'));
    assert.ok(task.definitions.every(d => d.actions.every(a => typeof a.id === 'string')));
  }
});

test('inspection enables affordable coupled pipeline plans; globally robust configuration exceeds budget', () => {
  const profiles = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const task = createTask({ taskId: 'temporal_pipeline', seed });
    const careful = execute(task, (d, history) => {
      if (d.checkpointId === 'inspection') return 'inspect';
      const result = history[0].result;
      if (d.checkpointId === 'encoding') return result.includes('source burst: yes') ? 'compact' : 'raw';
      if (d.checkpointId === 'bridge') return result.includes('source burst: yes') && result.includes('legacy recipient: yes') ? 'transcode' : 'passthrough';
      if (d.checkpointId === 'buffer') return result.includes('handoff interruption: yes') ? 'durable' : 'transient';
      return d.actions[0].id;
    });
    assert.ok(careful.checks.every(c => c.passed));
    assert.ok(careful.state.spent <= 7);
    profiles.add(careful.history[0].result);
    const robust = execute(task, d => ({ inspection: 'skip', encoding: 'compact', bridge: 'transcode', buffer: 'durable' }[d.checkpointId] ?? d.actions[0].id));
    assert.ok(robust.checks.filter(c => c.id !== 'effort_budget').every(c => c.passed));
    assert.equal(robust.checks.find(c => c.id === 'effort_budget').passed, false);
  }
  assert.equal(profiles.size, 3);
});

test('coupled pipeline can need two repairs: encoding alone creates a compatibility regression', () => {
  let exercised = false;
  for (let seed = 0; seed < 30 && !exercised; seed++) {
    const task = createTask({ taskId: 'temporal_pipeline', seed });
    const basic = execute(task, d => ({ inspection: 'inspect', encoding: 'raw', bridge: 'passthrough', buffer: 'transient' }[d.checkpointId] ?? d.actions[0].id));
    if (!basic.history[0].result.includes('source burst: yes; legacy recipient: yes')) continue;
    const encodingOnly = execute(task, d => ({ inspection: 'inspect', encoding: 'compact', bridge: 'passthrough', buffer: 'transient' }[d.checkpointId] ?? d.actions[0].id));
    assert.equal(basic.checks.find(c => c.id === 'link_capacity').passed, false);
    assert.equal(basic.checks.find(c => c.id === 'recipient_compatibility').passed, true);
    assert.equal(encodingOnly.checks.find(c => c.id === 'link_capacity').passed, true);
    assert.equal(encodingOnly.checks.find(c => c.id === 'recipient_compatibility').passed, false);
    exercised = true;
  }
  assert.ok(exercised);
});

test('pipeline delay moves detection while preserving workload, affordable solutions and horizon', () => {
  for (let seed = 0; seed < 5; seed++) {
    const early = createTask({ taskId: 'temporal_pipeline', seed, delay: 0 });
    const late = createTask({ taskId: 'temporal_pipeline', seed, delay: 7 });
    const choose = d => ({ inspection: 'inspect', encoding: 'raw', bridge: 'passthrough', buffer: 'transient' }[d.checkpointId] ?? d.actions[0].id);
    const a = execute(early, choose), b = execute(late, choose);
    assert.equal(a.history.length, 14); assert.equal(b.history.length, 14);
    assert.equal(a.history[0].result, b.history[0].result);
    assert.equal(a.state.spent, b.state.spent);
    assert.deepEqual(a.history.map(s => s.action.id), b.history.map(s => s.action.id));
    assert.deepEqual(a.checks.map(c => [c.id, c.passed]), b.checks.map(c => [c.id, c.passed]));
    for (const c of a.checks.filter(c => c.id !== 'effort_budget')) assert.equal(b.checks.find(item => item.id === c.id).detectedAt - c.detectedAt, 7);
  }
});

test('reservation ledger sums concurrent intervals and handles effective release and exclusive expiry', () => {
  for (let seed = 0; seed < 8; seed++) for (const stateMode of ['updates', 'temporal']) {
    const task = createTask({ taskId: 'state_reservations', seed, stateMode });
    const capacity = Number(/pool has (\d+) capacity/.exec(task.public.rules[0])[1]);
    const result = execute(task, d => {
      if (d.actions.length === 1) return d.actions[0].id;
      const asOf = Number(/effective time (\d+)/.exec(d.observation)[1]);
      const occupied = stateMode === 'updates' ? (d.t === 6 ? 4 : d.t === 10 ? 9 : 12) : d.t === 6 ? 2 : d.t === 10 || asOf === 9 ? 3 : 1;
      return String(capacity - occupied);
    });
    assert.ok(result.checks.every(c => c.passed));
    assert.equal(result.state.spent, 0);
  }
});

test('task control validation rejects unsupported experimental settings', () => {
  for (const options of [{ stateMode: 'unknown' }, { interference: -1 }, { interference: 4 }, { interference: 1.5 }]) assert.throws(() => createTask({ taskId: 'state_ledger', seed: 42, ...options }));
});
