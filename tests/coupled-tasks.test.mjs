import test from 'node:test';
import assert from 'node:assert/strict';
import { COUPLED_PAIR_COUNT, createCoupledTask, createHardCoupledTask, simulateCoupled, simulateCoupledFeedback } from '../benchmark/coupled-tasks.mjs';
import { runMatchedDynamics } from '../benchmark/matched-dynamics.mjs';

const arm = (time, channel) => ({ time, channel, operation: 'arm' });
const cancel = (time, channel) => ({ time, channel, operation: 'cancel' });
const relay = { leftDelay: 2, rightDelay: 4, retrigger: 'restart', coupling: 'relay' };
const cut = { ...relay, coupling: 'cut' };
const feedback = { ...relay, hold: 2, latency: 3 };

test('coupling can arm, extend or cancel a timer at a commitment with no external input', () => {
  const isolated = { inputs: [arm(0, 'left')] };
  assert.equal(simulateCoupled(relay, isolated, 2), 'committed_pending');
  assert.equal(simulateCoupled(cut, isolated, 2), 'committed_idle');
  const overlap = { inputs: [arm(0, 'right'), arm(0, 'left')] };
  assert.equal(simulateCoupled(relay, overlap, 4), 'committed_pending');
  assert.equal(simulateCoupled(relay, overlap, 6), 'committed_committed');
  assert.equal(simulateCoupled({ ...relay, retrigger: 'keep' }, overlap, 4), 'committed_committed');
  assert.equal(simulateCoupled(cut, overlap, 4), 'committed_idle');
});

test('simultaneous commitments settle together and coupling precedes external inputs', () => {
  const tied = { inputs: [arm(0, 'right'), arm(2, 'left'), cancel(4, 'right')] };
  assert.equal(simulateCoupled(cut, tied, 4), 'committed_committed');
  assert.equal(simulateCoupled(relay, tied, 4), 'committed_committed');
  const externalTie = { inputs: [arm(0, 'left'), cancel(2, 'right')] };
  assert.equal(simulateCoupled(relay, externalTie, 2), 'committed_idle');
});

test('coupled cases use a new input sequence and the selected rule stays private in infer mode', () => {
  for (const seed of [0, 42, 2147483647]) {
    for (let pairIndex = 0; pairIndex < COUPLED_PAIR_COUNT; pairIndex++) {
      for (const side of ['a', 'b']) {
        const task = createCoupledTask({ seed, pairIndex, side });
        assert.equal(task.public.providedMechanism, null);
        assert.equal(task.learningAudit().targetScheduleNovel, true);
        assert.equal(task.learningAudit().consistentMechanisms, 1);
      }
    }
  }
});

test('feedback timers expire before signal delivery, and external cancellation follows delivery', () => {
  // Right commits at 4 and expires at 6. Left commits at 3, expires at 5,
  // and its arm signal still reaches right at 6.
  const inputs = [arm(0, 'right'), arm(1, 'left')];
  assert.equal(simulateCoupledFeedback(feedback, { inputs }, 5), 'idle_committed');
  assert.equal(simulateCoupledFeedback(feedback, { inputs }, 6), 'idle_pending');
  assert.equal(simulateCoupledFeedback(feedback, { inputs: [...inputs, cancel(6, 'right')] }, 6), 'idle_idle');
});

test('one external arm can cause multiple rounds of autonomous feedback', () => {
  const run = { inputs: [arm(0, 'left')] };
  const handDerived = [
    [2, 'committed_idle'],
    [4, 'idle_idle'],
    [5, 'idle_pending'],
    [9, 'idle_committed'],
    [11, 'idle_idle'],
    [12, 'pending_idle'],
    [14, 'committed_idle'],
    [17, 'idle_pending'],
    [21, 'idle_committed'],
  ];
  for (const [horizon, expected] of handDerived) {
    assert.equal(simulateCoupledFeedback(feedback, run, horizon), expected, `State at ${horizon}`);
  }
});

test('public calibration identifies both hard pilot pairs and the offline controls stay distinct', async () => {
  for (const pairIndex of [2, 5]) {
    for (const side of ['a', 'b']) {
      const task = createHardCoupledTask({ seed: 42, pairIndex, side });
      assert.equal(task.public.providedMechanism, null);
      assert.equal(task.learningAudit().targetScheduleNovel, true);
      assert.equal(task.learningAudit().consistentMechanisms, 1);
    }
  }
  const report = await runMatchedDynamics({ taskId: 'coupled_feedback', seed: 42, pairIds: [3, 6] });
  assert.equal(report.status, 'completed');
  for (const id of ['infer', 'given']) {
    const score = report.conditions.find(condition => condition.id === id).summary;
    assert.equal(score.correctForecastCount, 24);
    assert.equal(score.bothCorrectFlipQueries, 10);
  }
  const ablated = report.conditions.find(condition => condition.id === 'ablated').summary;
  assert.equal(ablated.correctForecastCount, 6);
  assert.equal(ablated.bothCorrectFlipQueries, 0);
});
