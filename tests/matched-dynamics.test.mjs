import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatchedDynamics, validateMatchedOptions } from '../benchmark/matched-dynamics.mjs';
import { parseArgs } from '../cli.mjs';

test('matched pilot separates exact learning from two calibration-blind baselines', async () => {
  const report = await runMatchedDynamics();
  assert.equal(report.kind, 'matched_dynamics');
  assert.equal(report.status, 'completed');
  assert.equal(report.reportHash, (await runMatchedDynamics()).reportHash);
  assert.equal(report.costs.modelUsage, null);
  const [infer, given, ablated, constant] = report.conditions.map(condition => condition.summary);
  for (const summary of [infer, given, ablated, constant]) {
    assert.equal(summary.completePairs, 8);
    assert.equal(summary.scoredForecastCount, 96);
    assert.equal(summary.scoredFlipQueries, 22);
  }
  assert.equal(infer.bothCorrectFlipQueries, 22);
  assert.equal(given.bothCorrectFlipQueries, 22);
  assert.equal(infer.correctForecastCount, 96);
  assert.equal(given.correctForecastCount, 96);
  assert.equal(ablated.correctForecastCount, 72);
  assert.equal(constant.correctForecastCount, 42);
  assert.equal(ablated.pairedAccuracy, 0);
  assert.equal(constant.pairedAccuracy, 0);
});

test('calibration-ablated sides deliver identical actor contexts and score against different realized futures', async () => {
  const contexts = [];
  const policy = { decide(context) {
    contexts.push(context);
    assert.equal(context.providedMechanism, null);
    assert.equal(context.history.filter(step => step.phase === 'calibration').length, 3);
    for (const step of context.history.filter(step => step.phase === 'forecast')) assert.equal(step.result, 'Prediction frozen.');
    for (const key of ['seed', 'pairIndex', 'side', 'answerKey', 'instanceId']) assert.equal(Object.hasOwn(context, key), false);
    return { actionId: 'pending', reasoning: 'Test constant policy.' };
  } };
  const report = await runMatchedDynamics({ policyKind: 'custom', condition: 'ablated' }, { policy });
  assert.equal(contexts.length, 96);
  for (let i = 0; i < contexts.length; i += 12) {
    assert.deepEqual(contexts.slice(i, i + 6), contexts.slice(i + 6, i + 12));
  }
  assert.deepEqual(report.conditions.map(condition => condition.id), ['ablated', 'always_pending']);
  assert.equal(report.conditions[0].summary.pairedAccuracy, 0);
});

test('matched CLI selects a condition and insufficient model budget fails before calls', async () => {
  const parsed = parseArgs(['matched', '--condition', 'infer', '--policy', 'compatible']);
  assert.equal(parsed.operation, 'matched');
  await assert.rejects(runMatchedDynamics(parsed.options, { policy: {
    usage: () => ({ maxCalls: 95, calls: 0 }),
    decide: () => assert.fail('Budget must be checked before any model call.'),
  } }), /requires a budget of 96 model calls/);
});

test('matched CLI preserves the same selected pair IDs in every condition and budgets only selected pairs', async () => {
  const { options } = parseArgs(['matched', '--task', 'coupled_commit', '--pairs', '5,1']);
  const report = await runMatchedDynamics(options);
  assert.deepEqual(report.options.pairIds, [5, 1]);
  assert.equal(report.protocol.pairCount, 2);
  for (const condition of report.conditions) {
    assert.deepEqual(condition.pairs.map(pair => pair.pairIndex), [4, 0]);
    assert.equal(condition.summary.scoredForecastCount, 24);
  }
  await assert.rejects(runMatchedDynamics({ ...options, policyKind: 'compatible' }, { policy: {
    usage: () => ({ maxCalls: 71, calls: 0 }),
    decide: () => assert.fail('Budget must be checked before any model call.'),
  } }), /requires a budget of 72 model calls/);
});

test('matched selector rejects malformed, duplicate and out-of-range pair IDs', () => {
  for (const value of ['1,', '0', '1.5', '1, 5']) {
    assert.throws(() => parseArgs(['matched', '--pairs', value]), /positive integers/);
  }
  assert.throws(() => parseArgs(['evaluate', '--pairs', '1']), /only to matched/);
  for (const pairIds of [[], null, [1, 1], [0], [9], ['1']]) {
    assert.throws(() => validateMatchedOptions({ pairIds }), /distinct pair IDs between 1 and 8/);
  }
});

test('coupled pilot keeps the shared controls and lowers calibration-blind accuracy', async () => {
  const { options } = parseArgs(['matched', '--task', 'coupled_commit']);
  const report = await runMatchedDynamics(options);
  assert.equal(report.status, 'completed');
  assert.equal(report.protocol.task, 'coupled_commit');
  assert.equal(report.costs.modelUsage, null);
  assert.deepEqual(report.conditions.map(condition => condition.id), ['infer', 'given', 'ablated', 'always_committed_committed']);
  const [infer, given, ablated, constant] = report.conditions.map(condition => condition.summary);
  for (const summary of [infer, given, ablated, constant]) {
    assert.equal(summary.completePairs, 8);
    assert.equal(summary.scoredForecastCount, 96);
    assert.equal(summary.scoredFlipQueries, infer.scoredFlipQueries);
  }
  assert.ok(infer.scoredFlipQueries > 22);
  assert.equal(infer.pairedAccuracy, 1);
  assert.equal(given.pairedAccuracy, 1);
  assert.equal(infer.correctForecastCount, 96);
  assert.equal(given.correctForecastCount, 96);
  assert.ok(ablated.forecastAccuracy < 0.75);
  assert.ok(constant.forecastAccuracy < 0.4375);
  assert.equal(ablated.pairedAccuracy, 0);
  assert.equal(constant.pairedAccuracy, 0);
});
