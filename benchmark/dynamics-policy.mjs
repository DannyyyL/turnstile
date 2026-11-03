// Server-only exact reference policy. Every input to this solver is public;
// task closures, seeds and evaluator answer keys are never consulted.
export function simulateDynamics(mechanism, run, horizon) {
  if (![2, 4, 6].includes(mechanism?.delay) || !['restart', 'ignore'].includes(mechanism?.retrigger)) throw new RangeError('Unknown delayed-commit mechanism.');
  if (!run || !Number.isFinite(run.startTime) || run.initialState !== 'idle' || !Array.isArray(run.inputs)
    || !Number.isFinite(horizon) || horizon < run.startTime) throw new RangeError('Invalid dynamics run or horizon.');
  let previousTime = run.startTime;
  for (const input of run.inputs) {
    if (!Number.isFinite(input.time) || input.time < previousTime || !['arm', 'cancel'].includes(input.type)) throw new RangeError('Inputs must be ordered arm/cancel events at or after startTime.');
    previousTime = input.time;
  }
  let state = 'idle', deadline = null;
  const settle = time => {
    if (state === 'pending' && deadline <= time) { state = 'committed'; deadline = null; }
  };
  for (const input of run.inputs) {
    if (input.time > horizon) break;
    // A commitment wins a tie with an input. Equal-time inputs keep list order.
    settle(input.time);
    if (input.type === 'arm' && (state === 'idle' || state === 'pending' && mechanism.retrigger === 'restart')) {
      state = 'pending'; deadline = input.time + mechanism.delay;
    } else if (input.type === 'cancel' && state === 'pending') {
      state = 'idle'; deadline = null;
    }
  }
  settle(horizon);
  return state;
}

export function consistentDynamics(calibrations, candidates) {
  if (!Array.isArray(calibrations) || !Array.isArray(candidates)) throw new RangeError('Provide calibration runs and candidate mechanisms.');
  return candidates.filter(candidate => calibrations.every(run => Array.isArray(run.observations)
    && run.observations.every(observation => simulateDynamics(candidate, run, observation.time) === observation.state)))
    .map(candidate => ({ ...candidate }));
}

export function predictDynamics(mechanisms, run, horizon) {
  if (!Array.isArray(mechanisms) || !mechanisms.length) throw new RangeError('No mechanism fits the supplied evidence.');
  const states = new Set(mechanisms.map(mechanism => simulateDynamics(mechanism, run, horizon)));
  return states.size === 1 ? [...states][0] : 'underdetermined';
}

const firstLineData = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));

export function createDynamicsReferencePolicy() {
  return {
    kind: 'reference',
    decide(context) {
      if (context.actions.length === 1) return { actionId: context.actions[0].id, reasoning: 'Record the supplied calibration.' };
      const calibrations = context.history.filter(step => step.observation.startsWith('Observed run: ')).map(step => firstLineData(step.observation));
      const candidates = context.providedMechanism ? [context.providedMechanism] : context.candidateMechanisms;
      const consistent = consistentDynamics(calibrations, candidates);
      const forecast = firstLineData(context.observation);
      const actionId = predictDynamics(consistent, forecast, forecast.horizon);
      if (!context.actions.some(action => action.id === actionId)) throw new RangeError('The predicted state is not an available action.');
      return { actionId, reasoning: `Offline exact reference: ${consistent.length} mechanism(s) fit the public calibration; simulate each to the requested horizon.` };
    },
  };
}
