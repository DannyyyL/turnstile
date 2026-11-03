import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMatchedPairs } from '../benchmark/matched-scoring.mjs';

const side = (...passed) => ({
  queryCount: passed.length,
  attempt: { status: 'completed', outcome: { checks: passed.map((value, i) => ({ id: `forecast_${i + 1}`, passed: value })) } },
});

test('paired mechanism credit requires both sides correct on a flipped horizon', () => {
  const result = summarizeMatchedPairs([{
    pairIndex: 0, changedCheckpoints: ['forecast_1', 'forecast_2'],
    sides: [side(true, true, true), side(true, false, true)],
  }, {
    pairIndex: 1, changedCheckpoints: ['forecast_2'],
    sides: [side(true, false, true), side(true, true, true)],
  }]);
  assert.equal(result.forecastAccuracy, 10 / 12);
  assert.equal(result.requiredFlipQueries, 3);
  assert.equal(result.bothCorrectFlipQueries, 1);
  assert.equal(result.pairedAccuracy, 1 / 3);
  assert.deepEqual(result.pairs.map(pair => pair.pairedAccuracy), [1 / 2, 0]);
});

test('incomplete pairs retain coverage and completed-side forecasts', () => {
  const result = summarizeMatchedPairs([{
    pairIndex: 0, changedCheckpoints: ['forecast_1'],
    sides: [side(false, true), { queryCount: 2, attempt: { status: 'error' } }],
  }]);
  assert.equal(result.completePairs, 0);
  assert.equal(result.incompletePairs, 1);
  assert.equal(result.forecastCount, 4);
  assert.equal(result.scoredForecastCount, 2);
  assert.equal(result.forecastAccuracy, 1 / 2);
  assert.equal(result.requiredFlipQueries, 1);
  assert.equal(result.scoredFlipQueries, 0);
  assert.equal(result.bothCorrectFlipQueries, null);
  assert.equal(result.pairedAccuracy, null);
  assert.equal(result.pairs[0].pairedAccuracy, null);
});
