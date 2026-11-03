// Evaluator-only generators. Public reference simulation takes explicit public
// inputs; the selected mechanism and expected forecasts stay in these closures.
import { simulateDynamics, consistentDynamics, predictDynamics } from './dynamics-policy.mjs';

export const DYNAMICS_TASKS = [{
  id: 'delayed_commit', family: 'dynamics_learning', label: 'Learn delayed commitment', split: 'development', suite: 'dynamics',
  capabilities: ['in_context_dynamics_learning', 'delayed_effects', 'history_dependence', 'unseen_future_prediction'],
}];

const clone = value => structuredClone(value);
const candidates = [2, 4, 6].flatMap(delay => ['restart', 'ignore'].map(retrigger => ({ delay, retrigger })));
const states = ['idle', 'pending', 'committed', 'underdetermined'];
const matchedCases = [
  // Retrigger-only contrasts: sustained retriggering, cancellation at the
  // original deadline, and a late retrigger before a cancellation.
  { mechanisms: [[2, 'restart'], [2, 'ignore']], inputs: [[1, 'arm'], [2, 'arm'], [3, 'arm'], [4, 'arm'], [5, 'cancel']], horizons: [0, 1, 3, 4, 5, 6] },
  { mechanisms: [[4, 'restart'], [4, 'ignore']], inputs: [[0, 'arm'], [2, 'arm'], [3, 'arm'], [4, 'cancel'], [6, 'arm']], horizons: [0, 2, 4, 5, 6, 10] },
  { mechanisms: [[6, 'restart'], [6, 'ignore']], inputs: [[0, 'arm'], [2, 'arm'], [5, 'arm'], [8, 'cancel'], [9, 'arm']], horizons: [0, 2, 6, 8, 9, 16] },
  // Delay-only contrasts: deadlines coincident with cancellation, with and
  // without a pending retrigger after an initial canceled cycle.
  { mechanisms: [[2, 'ignore'], [4, 'ignore']], inputs: [[0, 'arm'], [2, 'cancel'], [3, 'arm'], [4, 'arm']], horizons: [0, 1, 2, 3, 4, 7] },
  { mechanisms: [[4, 'restart'], [6, 'restart']], inputs: [[0, 'arm'], [1, 'cancel'], [4, 'arm'], [6, 'arm'], [10, 'cancel']], horizons: [0, 1, 4, 8, 10, 13] },
  // Both factors differ: late cancellation, cancel/arm and repeated arm ties.
  { mechanisms: [[2, 'restart'], [6, 'ignore']], inputs: [[1, 'arm'], [2, 'arm'], [4, 'cancel'], [7, 'arm'], [8, 'arm']], horizons: [0, 1, 4, 7, 8, 13] },
  { mechanisms: [[2, 'ignore'], [6, 'restart']], inputs: [[0, 'arm'], [1, 'cancel'], [3, 'arm'], [4, 'arm'], [6, 'cancel'], [6, 'arm']], horizons: [0, 1, 3, 5, 6, 12] },
  { mechanisms: [[4, 'ignore'], [6, 'restart']], inputs: [[0, 'arm'], [2, 'arm'], [3, 'cancel'], [5, 'arm'], [5, 'arm'], [9, 'cancel'], [10, 'arm']], horizons: [0, 3, 5, 9, 10, 16] },
];

export const MATCHED_DYNAMICS_PAIR_COUNT = matchedCases.length;
function random(seed) {
  let x = (seed ^ 0x64796e61) >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let y = x;
    y = Math.imul(y ^ y >>> 15, y | 1);
    y ^= y + Math.imul(y ^ y >>> 7, y | 61);
    return ((y ^ y >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function calibrationRun(runId, startTime, relativeInputs, relativeSnapshots, mechanism) {
  const run = { runId, startTime, initialState: 'idle', inputs: relativeInputs.map(([time, type]) => ({ time: startTime + time, type })) };
  return { ...run, observations: relativeSnapshots.map(time => ({ time: startTime + time, state: simulateDynamics(mechanism, run, startTime + time) })) };
}
const parse = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

export function createDynamicsTask(options) {
  return buildDynamicsTask(options);
}

export function createMatchedDynamicsTask({ seed, pairIndex, side, ruleAccess = 'infer' }) {
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= matchedCases.length) throw new RangeError('Invalid matched dynamics pair index.');
  if (!['a', 'b'].includes(side)) throw new RangeError('Matched dynamics side must be a or b.');
  return buildDynamicsTask({ seed, ruleAccess }, { pairIndex, side });
}

function buildDynamicsTask({ taskId = 'delayed_commit', seed, variant = 'base', ruleAccess = 'infer', interference = 0, timeOffset = 0 }, match) {
  if (taskId !== 'delayed_commit') throw new RangeError('Unknown dynamics-learning task.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new RangeError('Invalid task seed.');
  if (!['base', 'temporal_shift'].includes(variant)) throw new RangeError('variant must be base or temporal_shift.');
  const ablated = match && ruleAccess === 'ablated';
  if (!['infer', 'given'].includes(ruleAccess) && !ablated) throw new RangeError('ruleAccess must be infer or given.');
  if (!Number.isInteger(interference) || interference < 0 || interference > 3) throw new RangeError('interference must be between 0 and 3.');
  if (!Number.isInteger(timeOffset) || Math.abs(timeOffset) > 1000000) throw new RangeError('timeOffset must be an integer between -1000000 and 1000000.');
  const rng = random(seed);
  const draw = rng();
  const matchedCase = match && matchedCases[match.pairIndex];
  let mechanism = candidates[Math.floor(draw * candidates.length)];
  if (matchedCase) {
    const firstSide = draw < 0.5 ? 'b' : 'a';
    const [delay, retrigger] = matchedCase.mechanisms[match.side === firstSide ? 0 : 1];
    mechanism = { delay, retrigger };
  }
  // Probe schedules vary independently of which mechanism was selected. These
  // observations, rather than a task ID or a mechanism-coded plan, identify it.
  const origins = Array.from({ length: 3 }, () => timeOffset + Math.floor(rng() * 4));
  const cancelTime = rng() < 0.5 ? 2 : 4;
  const calibrations = [
    calibrationRun('observed_1', origins[0], [[0, 'arm']], [2, 4, 6, 7], mechanism),
    calibrationRun('observed_2', origins[1], [[0, 'arm'], [1, 'arm']], [2, 4, 6, 7], mechanism),
    calibrationRun('observed_3', origins[2], [[0, 'arm'], [cancelTime, 'cancel']], [1, cancelTime, cancelTime + 6], mechanism),
  ];
  const consistent = consistentDynamics(calibrations, candidates);
  if (consistent.length !== 1) throw new Error('Calibration must identify exactly one mechanism.');

  const issueTime = 20 + timeOffset;
  // This input composition is absent from calibration. It cancels the initial
  // pending process, then tests both delay and retriggering on a fresh arm pair.
  const targetInputs = matchedCase?.inputs ?? [[0, 'arm'], [1, 'arm'], [1, 'cancel'], [4, 'arm'], [5, 'arm']];
  const target = { runId: 'forecast', startTime: issueTime, initialState: 'idle', issueTime,
    inputs: targetInputs.map(([time, type]) => ({ time: issueTime + time, type })) };
  const horizons = (matchedCase?.horizons ?? [variant === 'temporal_shift' ? 12 : 5, 6, 7, 8, 9, 10]).map(time => issueTime + time);
  const expected = new Map(horizons.map((horizon, i) => [`forecast_${i + 1}`, predictDynamics(consistent, target, horizon)]));
  const definitions = calibrations.map((run, i) => ({
    t: i + 1, checkpointId: `calibration_${i + 1}`, phase: 'calibration',
    observation: [`Observed run: ${JSON.stringify(ablated ? { ...run, observations: [] } : run)}`,
      ...Array.from({ length: interference }, (_, channel) => `Unrelated maintenance channel ${channel + 1}: archive status normal; no process inputs or observations changed.`)].join('\n'),
    actions: [{ id: 'continue', description: 'Record the completed calibration run.', cost: 0 }],
  }));
  for (let i = 0; i < horizons.length; i++) definitions.push({
    t: i + 4, checkpointId: `forecast_${i + 1}`, phase: 'forecast',
    observation: `Forecast query: ${JSON.stringify({ ...target, horizon: horizons[i] })}\nCommit this prediction using the calibration. No outcome from this fresh run has been observed.`,
    actions: shuffled(states, rng).map(value => ({ id: value, description: `Predict: ${value}`, cost: 0 })),
  });

  return {
    public: {
      taskType: 'dynamics_learning', ruleAccess,
      objective: ablated
        ? 'Predict the actual states of a fresh run before any of its outcomes are revealed. The calibration input schedules are visible, but their state observations have been withheld.'
        : 'Learn the fixed mechanism from three observed runs and predict the states of a fresh run before any of its outcomes are revealed.',
      candidateMechanisms: clone(candidates),
      providedMechanism: ruleAccess === 'given' ? clone(mechanism) : null,
      rules: [
        'One fixed mechanism from candidateMechanisms governs every observed and forecast run. Its delay is 2, 4 or 6 time units; its pending retrigger rule is restart or ignore. In infer mode, infer that mechanism from the observed runs.',
        'Each independent run begins idle at startTime. An arm input while idle starts a pending process, scheduled to commit after the mechanism delay.',
        'An arm while pending either restarts that delay from the new arm time (restart) or leaves the existing deadline unchanged (ignore).',
        'A cancel while pending returns the process to idle and removes its deadline. A cancel while idle does nothing.',
        'Committed is persistent and ignores all later inputs. Time passing can commit a pending process without any new input.',
        'Boundary order is explicit: a scheduled commitment at time T happens before inputs at T; equal-time inputs execute in listed order; a snapshot at T is taken after inputs at T.',
        'Calibration observations are completed independent runs. Forecast inputs are a known schedule, not observations of their consequences.',
        'All six forecasts are committed together at their shared issueTime. Query order does not advance the observed world. Earlier forecast answers are predictions, not evidence or outcome feedback.',
        ablated
          ? 'Use the available evidence to make your best prediction of idle, pending or committed. You may answer underdetermined when the evidence is inconclusive, but only a correct actual state earns prediction credit in this control.'
          : 'Predict idle, pending or committed if every mechanism consistent with the available calibration agrees. Otherwise predict underdetermined; do not guess the evaluator mechanism.',
        'In given mode providedMechanism deliberately supplies the rule as a control; this measures applying a known mechanism rather than learning it.',
        'Maintenance-channel observations are irrelevant and do not change any process input, calibration observation or future outcome.',
      ],
      effortBudget: null,
    },
    definitions,
    transition(definition, chosen, state) {
      state.choices[definition.checkpointId] = chosen.id;
      return definition.phase === 'calibration' ? 'Calibration recorded.' : 'Prediction frozen.';
    },
    score(state) {
      return horizons.map((_, i) => {
        const id = `forecast_${i + 1}`, passed = state.choices[id] === expected.get(id);
        return { id, passed, detectedAt: 9, decisionT: i + 4, candidateCheckpoints: [id],
          observation: ablated
            ? `The frozen prediction at ${id} was ${passed ? 'correct' : 'incorrect'} for the actual state.`
            : `The frozen prediction at ${id} was ${passed ? 'correct' : 'incorrect'} under the mechanisms consistent with calibration.` };
      });
    },
    answerKey: () => [...expected].map(([checkpointId, answerId]) => ({ checkpointId, answerId })),
    learningAudit: () => ({ calibrationRuns: 3, forecastQueries: 6, consistentMechanisms: ablated ? candidates.length : consistent.length,
      targetScheduleNovel: calibrations.every(run => JSON.stringify(run.inputs.map(input => input.type)) !== JSON.stringify(target.inputs.map(input => input.type))) }),
    instanceId: match
      ? `matched_delayed_commit:${seed}:${match.pairIndex}:${match.side}:${ruleAccess}`
      : `${taskId}:${seed}:${variant}:${ruleAccess}:interference${interference}:offset${timeOffset}`,
  };
}

/** Evaluator-only paired audit, containing no mechanism or answer labels. */
export function auditDynamicsPair(left, right) {
  if (JSON.stringify(left.public) !== JSON.stringify(right.public) || left.definitions.length !== right.definitions.length) throw new Error('A dynamics timestamp pair must preserve public rules and schedule.');
  const changedTimestampFields = [];
  for (let i = 0; i < left.definitions.length; i++) {
    const a = left.definitions[i], b = right.definitions[i];
    if (JSON.stringify([a.t, a.checkpointId, a.phase, a.actions]) !== JSON.stringify([b.t, b.checkpointId, b.phase, b.actions])) throw new Error('A dynamics pair changed checkpoints or options.');
    if (a.observation === b.observation) continue;
    if (a.phase !== 'forecast') throw new Error('A dynamics pair changed calibration.');
    const x = parse(a.observation), y = parse(b.observation);
    if (x.horizon === y.horizon) throw new Error('A dynamics pair changed a non-horizon field.');
    delete x.horizon; delete y.horizon;
    if (JSON.stringify(x) !== JSON.stringify(y) || a.observation.split('\n').slice(1).join('\n') !== b.observation.split('\n').slice(1).join('\n')) throw new Error('A dynamics pair changed non-temporal facts.');
    changedTimestampFields.push({ checkpointId: a.checkpointId, field: 'horizon' });
  }
  const answers = left.answerKey(), other = right.answerKey();
  const changedCheckpoints = answers.filter((answer, i) => answer.answerId !== other[i].answerId).map(answer => answer.checkpointId);
  if (changedTimestampFields.length !== 1 || !changedCheckpoints.length) throw new Error('A dynamics pair must change exactly one timestamp and require an answer flip.');
  return { onlyTemporalMetadataChanged: true, changedTimestampFields, changedQueryCount: changedCheckpoints.length, changedCheckpoints };
}
