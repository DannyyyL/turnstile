/** Evaluator-only coupled timers and public-evidence reference policies. */
const CHANNELS = ['left', 'right'];
const DELAYS = [2, 4, 6];
const STATES = ['idle', 'pending', 'committed'];
const CHOICES = STATES.flatMap(left => STATES.map(right => `${left}_${right}`));
const CANDIDATES = DELAYS.flatMap(leftDelay => DELAYS.flatMap(rightDelay =>
  ['restart', 'keep'].flatMap(retrigger => ['relay', 'cut'].map(coupling => ({ leftDelay, rightDelay, retrigger, coupling })))));

export function simulateCoupled(mechanism, run, horizon) {
  const timers = {
    left: { state: 'idle', deadline: Infinity, delay: mechanism.leftDelay },
    right: { state: 'idle', deadline: Infinity, delay: mechanism.rightDelay },
  };
  const apply = (channel, operation, time) => {
    const timer = timers[channel];
    if (timer.state === 'committed') return;
    if (operation === 'cancel') {
      timer.state = 'idle';
      timer.deadline = Infinity;
    } else if (timer.state === 'idle' || mechanism.retrigger === 'restart') {
      timer.state = 'pending';
      timer.deadline = time + timer.delay;
    }
  };
  const advance = through => {
    for (;;) {
      const deadline = Math.min(timers.left.deadline, timers.right.deadline);
      if (deadline === Infinity || deadline > through) return;
      const due = CHANNELS.filter(channel => timers[channel].deadline === deadline);
      for (const channel of due) {
        timers[channel].state = 'committed';
        timers[channel].deadline = Infinity;
      }
      for (const channel of due) {
        apply(channel === 'left' ? 'right' : 'left', mechanism.coupling === 'relay' ? 'arm' : 'cancel', deadline);
      }
    }
  };
  for (const { time, channel, operation } of run.inputs) {
    if (time > horizon) break;
    advance(time);
    apply(channel, operation, time);
  }
  advance(horizon);
  return `${timers.left.state}_${timers.right.state}`;
}

export function simulateCoupledFeedback(mechanism, run, horizon) {
  const timers = {
    left: { state: 'idle', deadline: Infinity, delay: mechanism.leftDelay },
    right: { state: 'idle', deadline: Infinity, delay: mechanism.rightDelay },
  };
  const signals = [];
  const apply = (channel, operation, time) => {
    const timer = timers[channel];
    if (timer.state === 'committed') return;
    if (operation === 'cancel') {
      timer.state = 'idle';
      timer.deadline = Infinity;
    } else if (timer.state === 'idle' || mechanism.retrigger === 'restart') {
      timer.state = 'pending';
      timer.deadline = time + timer.delay;
    }
  };
  const advance = through => {
    for (;;) {
      const deadline = Math.min(timers.left.deadline, timers.right.deadline, signals[0]?.time ?? Infinity);
      if (deadline === Infinity || deadline > through) return;
      for (const channel of CHANNELS) {
        const timer = timers[channel];
        if (timer.deadline !== deadline) continue;
        if (timer.state === 'committed') {
          timer.state = 'idle';
          timer.deadline = Infinity;
        } else {
          timer.state = 'committed';
          timer.deadline = deadline + mechanism.hold;
          signals.push({ time: deadline + mechanism.latency, channel: channel === 'left' ? 'right' : 'left' });
        }
      }
      while (signals[0]?.time === deadline) {
        apply(signals.shift().channel, mechanism.coupling === 'relay' ? 'arm' : 'cancel', deadline);
      }
    }
  };
  for (const { time, channel, operation } of run.inputs) {
    if (time > horizon) break;
    advance(time);
    apply(channel, operation, time);
  }
  advance(horizon);
  return `${timers.left.state}_${timers.right.state}`;
}

const MATCHES = [
  // The first four pairs change only the coupling rule. Their forecasts cover
  // relays into idle and pending channels, external operations at a deadline,
  // and chains of commitments between the channels.
  { mechanisms: [[2, 2, 'restart', 'relay'], [2, 2, 'restart', 'cut']],
    inputs: [[0, 'right', 'arm'], [1, 'right', 'arm'], [7, 'left', 'arm'], [8, 'left', 'cancel'], [9, 'right', 'arm'], [9, 'left', 'arm']], horizons: [2, 3, 4, 5, 6, 7] },
  { mechanisms: [[2, 6, 'restart', 'cut'], [2, 6, 'restart', 'relay']],
    inputs: [[0, 'left', 'arm'], [0, 'right', 'cancel'], [2, 'left', 'cancel'], [4, 'left', 'arm'], [9, 'right', 'arm']], horizons: [1, 4, 7, 8, 10, 12] },
  { mechanisms: [[4, 6, 'restart', 'relay'], [4, 6, 'restart', 'cut']],
    inputs: [[0, 'right', 'arm'], [0, 'left', 'arm'], [4, 'left', 'arm'], [5, 'left', 'arm'], [6, 'left', 'cancel'], [6, 'left', 'arm']], horizons: [0, 4, 5, 7, 11, 12] },
  { mechanisms: [[2, 6, 'keep', 'relay'], [2, 6, 'keep', 'cut']],
    inputs: [[0, 'right', 'arm'], [4, 'left', 'cancel'], [5, 'left', 'arm'], [9, 'right', 'arm'], [9, 'right', 'cancel']], horizons: [4, 6, 7, 9, 11, 12] },
  // The other pairs vary delays, retriggering, or multiple parameters.
  { mechanisms: [[2, 2, 'keep', 'cut'], [4, 4, 'keep', 'cut']],
    inputs: [[0, 'right', 'arm'], [3, 'right', 'cancel'], [7, 'left', 'arm'], [8, 'right', 'cancel'], [9, 'left', 'arm']], horizons: [2, 4, 6, 8, 11, 12] },
  { mechanisms: [[4, 4, 'restart', 'relay'], [6, 2, 'restart', 'relay']],
    inputs: [[0, 'right', 'arm'], [1, 'left', 'arm'], [2, 'right', 'arm'], [8, 'right', 'arm'], [9, 'left', 'cancel']], horizons: [2, 3, 4, 5, 6, 9] },
  { mechanisms: [[6, 2, 'restart', 'relay'], [6, 2, 'keep', 'relay']],
    inputs: [[0, 'left', 'arm'], [0, 'right', 'cancel'], [5, 'left', 'arm'], [6, 'right', 'arm'], [6, 'left', 'arm'], [7, 'left', 'cancel']], horizons: [6, 7, 8, 9, 10, 12] },
  { mechanisms: [[4, 2, 'keep', 'cut'], [6, 6, 'restart', 'relay']],
    inputs: [[0, 'right', 'arm'], [5, 'right', 'cancel'], [7, 'right', 'cancel'], [8, 'left', 'arm'], [9, 'right', 'cancel']], horizons: [3, 5, 6, 9, 10, 11] },
];

export const COUPLED_PAIR_COUNT = MATCHES.length;

const HARD_FIELDS = { hold: [2, 4], latency: [1, 3] };
const BASE_FIELDS = { leftDelay: DELAYS, rightDelay: DELAYS, retrigger: ['restart', 'keep'], coupling: ['relay', 'cut'] };
const HARD_CANDIDATES = publicCandidates({ candidateMechanisms: { ...BASE_FIELDS, ...HARD_FIELDS } });
const HARD_MATCHES = [
  [[2, 4, 'restart', 'relay', 2, 1], [2, 4, 'restart', 'relay', 4, 3]],
  [[4, 2, 'keep', 'relay', 2, 3], [4, 2, 'keep', 'cut', 2, 3]],
  [[6, 4, 'restart', 'relay', 4, 1], [2, 6, 'restart', 'relay', 4, 1]],
  [[4, 6, 'keep', 'relay', 2, 3], [4, 6, 'restart', 'relay', 2, 3]],
  [[4, 6, 'restart', 'cut', 4, 1], [4, 6, 'restart', 'cut', 4, 3]],
  [[4, 6, 'restart', 'cut', 4, 3], [2, 4, 'keep', 'relay', 2, 3]],
];
export const HARD_COUPLED_PAIR_COUNT = HARD_MATCHES.length;

const HARD_CALIBRATION = [
  { inputs: [[0, 'left', 'arm'], [1, 'left', 'arm'], [7, 'right', 'arm'], [9, 'right', 'arm'], [10, 'left', 'arm'], [11, 'left', 'arm']],
    snapshots: [3, 6, 8, 13, 15, 17] },
  { inputs: [[0, 'right', 'arm'], [1, 'right', 'arm'], [3, 'left', 'arm'], [4, 'left', 'arm'], [9, 'right', 'arm'], [10, 'right', 'arm'], [11, 'left', 'arm']],
    snapshots: [3, 5, 8, 10, 13, 16] },
  { inputs: [[0, 'left', 'arm'], [1, 'right', 'arm'], [3, 'left', 'cancel'], [4, 'left', 'arm'], [8, 'right', 'cancel'], [10, 'right', 'arm'], [13, 'left', 'arm']],
    snapshots: [3, 6, 8, 10, 13, 17] },
];

const HARD_SCHEDULES = [
  [[0, 'left', 'arm'], [1, 'right', 'arm'], [3, 'left', 'arm'], [5, 'right', 'cancel'], [6, 'right', 'arm'], [9, 'left', 'cancel'], [10, 'left', 'arm'],
    [13, 'right', 'arm'], [15, 'left', 'arm'], [16, 'right', 'cancel'], [18, 'left', 'arm'], [21, 'right', 'arm'], [23, 'right', 'arm'], [25, 'left', 'cancel'],
    [27, 'left', 'arm'], [29, 'right', 'arm'], [30, 'left', 'arm'], [32, 'right', 'cancel'], [34, 'right', 'arm'], [35, 'left', 'arm']],
  [[0, 'right', 'arm'], [1, 'left', 'arm'], [2, 'right', 'arm'], [4, 'left', 'cancel'], [6, 'left', 'arm'], [8, 'right', 'arm'], [10, 'right', 'cancel'],
    [11, 'left', 'arm'], [14, 'right', 'arm'], [15, 'left', 'cancel'], [17, 'left', 'arm'], [18, 'left', 'arm'], [20, 'right', 'arm'], [22, 'right', 'arm'],
    [24, 'left', 'cancel'], [26, 'left', 'arm'], [29, 'right', 'arm'], [30, 'right', 'cancel'], [31, 'right', 'arm'], [35, 'left', 'arm']],
];

function random(seed) {
  let state = seed;
  return limit => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 4294967296 * limit);
  };
}

const parseRun = observation => JSON.parse(observation.slice(observation.indexOf(': ') + 2).split('\n')[0]);
const makeRun = (runId, startTime, inputs) => ({
  runId, startTime, initialState: 'idle_idle',
  inputs: inputs.map(([time, channel, operation]) => ({ time: time + startTime, channel, operation })),
});

function compatible(calibration, mechanisms, simulate = simulateCoupled) {
  return mechanisms.filter(mechanism => calibration.every(run => run.observations.every(({ time, state }) =>
    simulate(mechanism, run, time) === state)));
}

function makeActions(next) {
  const actions = [...CHOICES, 'underdetermined'].map(id => ({
    id, description: id === 'underdetermined' ? 'Underdetermined' : `Left ${id.split('_')[0]}, right ${id.split('_')[1]}`, cost: 0,
  }));
  for (let i = actions.length - 1; i > 0; i--) {
    const j = next(i + 1);
    [actions[i], actions[j]] = [actions[j], actions[i]];
  }
  return actions;
}

export function createCoupledTask(options) {
  return createTask(options, false);
}

export function createHardCoupledTask(options) {
  return createTask(options, true);
}

function createTask({ seed, pairIndex, side, ruleAccess = 'infer' }, hard) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new RangeError('Invalid coupled task seed.');
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= (hard ? HARD_MATCHES.length : MATCHES.length)) throw new RangeError('Invalid coupled pair index.');
  if (!['a', 'b'].includes(side) || !['infer', 'given', 'ablated'].includes(ruleAccess)) throw new RangeError('Invalid coupled side or rule access.');
  const simulate = hard ? simulateCoupledFeedback : simulateCoupled;
  const candidates = hard ? HARD_CANDIDATES : CANDIDATES;
  const next = random(seed ^ Math.imul(pairIndex + 1, 2654435761));
  const match = hard
    ? { mechanisms: HARD_MATCHES[pairIndex], inputs: HARD_SCHEDULES[pairIndex % HARD_SCHEDULES.length], horizons: [8, 13, 19, 25, 31, 38] }
    : MATCHES[pairIndex];
  const [leftDelay, rightDelay, retrigger, coupling, hold, latency] = match.mechanisms[Number(side === 'b') ^ next(2)];
  const mechanism = hard ? { leftDelay, rightDelay, retrigger, coupling, hold, latency } : { leftDelay, rightDelay, retrigger, coupling };
  const ablated = ruleAccess === 'ablated';
  const calibration = (hard ? HARD_CALIBRATION : [
    { inputs: [[0, 'left', 'arm'], [1, 'left', 'arm']], snapshots: [2, 3, 4, 5, 6, 7] },
    { inputs: [[0, 'right', 'arm'], [1, 'right', 'arm']], snapshots: [2, 3, 4, 5, 6, 7] },
    { inputs: [[0, 'left', 'arm'], [1, 'right', 'arm'], [3, 'left', 'cancel']], snapshots: [2, 3, 5, 8] },
  ]).map(({ inputs, snapshots }, index) => {
    const run = makeRun(`observed_${index + 1}`, index * 17 + next(4), inputs);
    return { ...run, observations: snapshots.map(offset => {
      const time = run.startTime + offset;
      return { time, state: simulate(mechanism, run, time) };
    }) };
  });
  if (compatible(calibration, candidates, simulate).length !== 1) throw new Error('Coupled calibration must identify exactly one mechanism.');

  const issueTime = 64 + next(8);
  const target = { ...makeRun('forecast', issueTime, match.inputs), issueTime };
  const horizons = match.horizons.map(offset => issueTime + offset);
  const forecastIds = horizons.map((_, index) => `forecast_${index + 1}`);
  const expected = horizons.map(horizon => simulate(mechanism, target, horizon));
  const definitions = calibration.map((run, index) => ({
    t: index + 1, checkpointId: `calibration_${index + 1}`, phase: 'calibration',
    observation: `Observed run: ${JSON.stringify(ablated ? { ...run, observations: [] } : run)}`,
    actions: [{ id: 'continue', description: 'Record the calibration run.', cost: 0 }],
  }));
  horizons.forEach((horizon, index) => definitions.push({
    t: index + 4, checkpointId: forecastIds[index], phase: 'forecast',
    observation: `Forecast query: ${JSON.stringify({ ...target, horizon })}\nPredict both channel states at the horizon. No outcome from this fresh run has been observed.`,
    actions: makeActions(next),
  }));
  return {
    public: {
      taskType: 'dynamics_learning', ruleAccess,
      objective: ablated
        ? 'Forecast both channel states in a fresh run. Calibration input schedules are visible and their state observations are withheld.'
        : 'Learn the fixed mechanism from three observed runs and forecast both channel states in a fresh run.',
      candidateMechanisms: structuredClone(hard ? { ...BASE_FIELDS, ...HARD_FIELDS } : BASE_FIELDS),
      providedMechanism: ruleAccess === 'given' ? { ...mechanism } : null,
      rules: [
        'Each candidate combines one value from each candidateMechanisms list. One fixed combination governs all runs.',
        'Both channels start idle. An arm on an idle channel makes it pending and sets a deadline equal to the current time plus that channel’s delay.',
        'An arm on a pending channel resets its deadline from the current time under restart and leaves its deadline unchanged under keep.',
        'A cancel makes a pending channel idle and clears its deadline. A cancel on idle has no effect.',
        ...(hard ? [
          'At a pending deadline the channel becomes committed. It remains committed for hold time units, ignores arm and cancel during that time, then returns to idle.',
          'Each commitment schedules exactly one signal to the other channel latency time units later. Delivery is independent of the sender’s state at delivery. Relay delivers arm and cut delivers cancel. A delivered operation follows the same rules as an external one.',
          'At each time, first process all pending deadlines and committed expiries together, then deliver scheduled signals, then apply external inputs at that time in listed order. Observe after all operations at that time. No other transitions occur.',
        ] : [
          'A channel commits at its deadline and stays committed. Committed channels ignore all later operations.',
          'Each commitment acts on the other channel at the commitment time. Relay applies arm to the other channel, including the normal pending retrigger rule. Cut applies cancel to the other channel.',
          'At each time, first mark all channels whose deadlines are due as committed together, then apply their cross-channel operations, then apply scheduled external inputs in list order. Observe the state after all operations at that time.',
        ]),
        'State labels always list the left channel first, then the right channel. A forecast earns credit when both channel states are correct.',
        'All forecasts share one issue time. Earlier forecast answers are guesses, and future inputs are a plan whose consequences have not been observed.',
        ablated
          ? 'Make your best forecast using the available information. Underdetermined is allowed but only the actual joint state earns credit in this control.'
          : 'Use the supplied mechanism in given mode or infer it from calibration. Choose underdetermined if compatible mechanisms imply different states.',
      ],
      effortBudget: null,
    },
    definitions,
    transition(definition, choice, state) {
      state.choices[definition.checkpointId] = choice.id;
      return definition.phase === 'calibration' ? 'Calibration recorded.' : 'Prediction frozen.';
    },
    score(state) {
      return forecastIds.map((id, index) => {
        const passed = state.choices[id] === expected[index];
        return { id, passed, detectedAt: definitions.length, decisionT: index + 4, candidateCheckpoints: [id],
          observation: `The frozen joint-state prediction at ${id} was ${passed ? 'correct' : 'incorrect'}.` };
      });
    },
    answerKey: () => forecastIds.map((checkpointId, index) => ({ checkpointId, answerId: expected[index] })),
    learningAudit: () => ({ calibrationRuns: 3, forecastQueries: 6, consistentMechanisms: ablated ? candidates.length : 1,
      targetScheduleNovel: calibration.every(run => JSON.stringify(run.inputs.map(input => [input.channel, input.operation])) !==
        JSON.stringify(target.inputs.map(input => [input.channel, input.operation]))) }),
    instanceId: `matched_${hard ? 'coupled_feedback' : 'coupled_commit'}:${seed}:${pairIndex}:${side}:${ruleAccess}`,
  };
}

function publicCandidates({ candidateMechanisms }) {
  return Object.entries(candidateMechanisms).reduce((candidates, [field, values]) =>
    candidates.flatMap(candidate => values.map(value => ({ ...candidate, [field]: value }))), [{}]);
}

export function createCoupledReferencePolicy() {
  return { kind: 'reference', decide(context) {
    const simulate = context.candidateMechanisms.hold ? simulateCoupledFeedback : simulateCoupled;
    const runs = context.history.filter(step => step.phase === 'calibration').map(step => parseRun(step.observation));
    const candidates = context.providedMechanism ? [context.providedMechanism] : compatible(runs, publicCandidates(context), simulate);
    const forecast = parseRun(context.observation);
    const states = new Set(candidates.map(mechanism => simulate(mechanism, forecast, forecast.horizon)));
    return { actionId: states.size === 1 ? [...states][0] : 'underdetermined',
      reasoning: `Simulate the ${candidates.length} public-evidence mechanisms to the forecast horizon.` };
  } };
}

export function createCoupledBlindPolicy() {
  return { kind: 'reference', decide(context) {
    const simulate = context.candidateMechanisms.hold ? simulateCoupledFeedback : simulateCoupled;
    const forecast = parseRun(context.observation);
    const states = publicCandidates(context).map(mechanism => simulate(mechanism, forecast, forecast.horizon));
    const ranked = CHOICES.map(id => ({ id, votes: states.filter(state => state === id).length }));
    ranked.sort((left, right) => right.votes - left.votes);
    return { actionId: ranked[0].id, reasoning: 'Forecast the plurality joint state across public candidates.' };
  } };
}
