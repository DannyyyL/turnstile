const accuracy = (correct, scored) => scored ? correct / scored : null;

function summarizePair({ pairIndex, changedCheckpoints, sides }) {
  const checks = sides.map(({ attempt, queryCount }) => {
    if (attempt?.status !== 'completed') return null;
    const results = new Map(attempt.outcome.checks.map(({ id, passed }) => [id, passed]));
    if (results.size !== queryCount || changedCheckpoints.some(id => !results.has(id))) {
      throw new Error('Completed matched case is missing forecast checks.');
    }
    return results;
  });
  const complete = checks.every(Boolean);
  const scored = checks.filter(Boolean).flatMap(results => [...results.values()]);
  const correctForecastCount = scored.filter(passed => passed).length;
  const requiredFlipQueries = changedCheckpoints.length;
  const scoredFlipQueries = complete ? requiredFlipQueries : 0;
  const bothCorrectFlipQueries = complete ? changedCheckpoints.filter(id => checks.every(results => results.get(id))).length : null;
  return {
    pairIndex, complete, forecastCount: sides.reduce((sum, side) => sum + side.queryCount, 0),
    scoredForecastCount: scored.length, correctForecastCount,
    forecastAccuracy: accuracy(correctForecastCount, scored.length),
    requiredFlipQueries, scoredFlipQueries, bothCorrectFlipQueries,
    pairedAccuracy: accuracy(bothCorrectFlipQueries, scoredFlipQueries),
  };
}

/** Score completed forecasts and require correctness on both sides of each answer flip. */
export function summarizeMatchedPairs(pairs) {
  const rows = pairs.map(summarizePair);
  const sum = key => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const completePairs = rows.filter(row => row.complete).length;
  const scoredForecastCount = sum('scoredForecastCount');
  const correctForecastCount = sum('correctForecastCount');
  const scoredFlipQueries = sum('scoredFlipQueries');
  const bothCorrectFlipQueries = scoredFlipQueries ? sum('bothCorrectFlipQueries') : null;
  return {
    pairCount: rows.length, completePairs, incompletePairs: rows.length - completePairs,
    forecastCount: sum('forecastCount'), scoredForecastCount, correctForecastCount,
    forecastAccuracy: accuracy(correctForecastCount, scoredForecastCount),
    requiredFlipQueries: sum('requiredFlipQueries'), scoredFlipQueries, bothCorrectFlipQueries,
    pairedAccuracy: accuracy(bothCorrectFlipQueries, scoredFlipQueries), pairs: rows,
  };
}
