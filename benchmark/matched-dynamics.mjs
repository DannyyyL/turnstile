import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { attempt, BENCHMARK_VERSION, sourceFingerprint, usageDelta, usageSnapshot, validateBenchmarkOptions } from './index.mjs';
import { createMatchedDynamicsTask, MATCHED_DYNAMICS_PAIR_COUNT } from './dynamics-tasks.mjs';
import { createDynamicsReferencePolicy, simulateDynamics } from './dynamics-policy.mjs';
import { createCoupledTask, COUPLED_PAIR_COUNT, createHardCoupledTask, HARD_COUPLED_PAIR_COUNT,
  createCoupledReferencePolicy, createCoupledBlindPolicy } from './coupled-tasks.mjs';
import { summarizeMatchedPairs } from './matched-scoring.mjs';
import { ModelError } from '../model-client.mjs';

const CONDITIONS = ['infer', 'given', 'ablated'];
const SIDES = ['a', 'b'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateMatchedOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Provide matched options as an object.');
  const { condition, taskId = 'delayed_commit', pairIds, ...options } = input;
  for (const key of Object.keys(options)) {
    if (!['seed', 'policyKind', 'model'].includes(key)) throw new RangeError(`Unknown matched option: ${key}.`);
  }
  if (condition != null && !CONDITIONS.includes(condition)) throw new RangeError('condition must be infer, given or ablated.');
  if (!Object.hasOwn(TASKS, taskId)) throw new RangeError(`Matched task must be one of ${Object.keys(TASKS).join(', ')}.`);
  const { pairCount } = TASKS[taskId];
  const selected = pairIds === undefined ? Array.from({ length: pairCount }, (_, index) => index + 1) : pairIds;
  if (!Array.isArray(selected) || !selected.length
      || [...selected].some(id => !Number.isInteger(id) || id < 1 || id > pairCount)
      || new Set(selected).size !== selected.length) {
    throw new RangeError(`Choose distinct pair IDs between 1 and ${pairCount}.`);
  }
  const { seed, policyKind, model } = validateBenchmarkOptions(options);
  return { taskId, seed, policyKind, model, condition: condition ?? null, pairIds: [...selected] };
}

function withoutStates(definitions) {
  return definitions.map(definition => {
    if (definition.phase !== 'calibration') return definition;
    const run = JSON.parse(definition.observation.split('\n')[0].slice('Observed run: '.length));
    delete run.observations;
    return { ...definition, observation: run };
  });
}

function buildPair(create, seed, pairIndex) {
  const tasks = Object.fromEntries(CONDITIONS.map(ruleAccess => [ruleAccess,
    SIDES.map(side => create({ seed, pairIndex, side, ruleAccess }))]));
  const [a, b] = tasks.infer;
  const [blindA, blindB] = tasks.ablated;
  if (!isDeepStrictEqual(a.public, b.public) || !isDeepStrictEqual(withoutStates(a.definitions), withoutStates(b.definitions))
      || !isDeepStrictEqual(blindA.public, blindB.public) || !isDeepStrictEqual(blindA.definitions, blindB.definitions)) {
    throw new Error('A mechanism pair changed inputs or leaked its identity outside the calibration states.');
  }
  const keys = a.answerKey(), other = b.answerKey();
  const changedCheckpoints = keys.filter((key, index) => key.answerId !== other[index].answerId).map(key => key.checkpointId);
  if (keys.length !== 6 || other.length !== 6 || !changedCheckpoints.length || isDeepStrictEqual(a.definitions, b.definitions)) {
    throw new Error('A mechanism pair must supply distinct evidence and require different forecasts.');
  }
  for (const [index, task] of tasks.infer.entries()) {
    const given = tasks.given[index], blind = tasks.ablated[index];
    if (!isDeepStrictEqual(task.answerKey(), given.answerKey()) || !isDeepStrictEqual(task.answerKey(), blind.answerKey())
        || !isDeepStrictEqual(task.definitions, given.definitions)
        || !isDeepStrictEqual(withoutStates(task.definitions.filter(d => d.phase === 'calibration')),
          withoutStates(blind.definitions.filter(d => d.phase === 'calibration')))
        || !isDeepStrictEqual(task.definitions.filter(d => d.phase === 'forecast').map(({ observation, actions }) => [observation.split('\n')[0], actions]),
          blind.definitions.filter(d => d.phase === 'forecast').map(({ observation, actions }) => [observation.split('\n')[0], actions]))) {
      throw new Error('An evidence control changed the future, forecast choices or answer key.');
    }
  }
  return { pairIndex, changedCheckpoints, tasks };
}

const blindPlurality = {
  decide(context) {
    const run = JSON.parse(context.observation.split('\n')[0].slice('Forecast query: '.length));
    const votes = context.candidateMechanisms.map(mechanism => simulateDynamics(mechanism, run, run.horizon));
    const ranked = ['idle', 'pending', 'committed'].map(state => ({ state, votes: votes.filter(vote => vote === state).length }));
    ranked.sort((a, b) => b.votes - a.votes);
    return { actionId: ranked[0].state, reasoning: 'Forecast the plurality state across the public candidate mechanisms.' };
  },
};

const TASKS = {
  delayed_commit: { create: createMatchedDynamicsTask, pairCount: MATCHED_DYNAMICS_PAIR_COUNT, constant: 'pending',
    reference: createDynamicsReferencePolicy, blind: () => blindPlurality },
  coupled_commit: { create: createCoupledTask, pairCount: COUPLED_PAIR_COUNT, constant: 'committed_committed',
    reference: createCoupledReferencePolicy, blind: createCoupledBlindPolicy },
  coupled_feedback: { create: createHardCoupledTask, pairCount: HARD_COUPLED_PAIR_COUNT, constant: 'committed_committed',
    reference: createCoupledReferencePolicy, blind: createCoupledBlindPolicy },
};

export async function runMatchedDynamics(input = {}, { policy, signal } = {}) {
  const options = validateMatchedOptions(input);
  if (Boolean(policy) !== (options.policyKind !== 'reference')) throw new RangeError('Use an explicit non-reference policy kind with an injected policy.');
  const selected = options.condition ? [options.condition] : CONDITIONS;
  const taskSpec = TASKS[options.taskId];
  const batch = options.pairIds.map(id => buildPair(taskSpec.create, options.seed, id - 1));
  const maxModelCalls = selected.length * batch.length * SIDES.length * 6;
  const before = usageSnapshot(policy);
  if (before && Number.isFinite(before.maxCalls) && before.maxCalls - before.calls < maxModelCalls) {
    throw new ModelError(`The matched run requires a budget of ${maxModelCalls} model calls. Increase the configured call limit or select one condition.`, 'MODEL_BUDGET');
  }
  const reference = taskSpec.reference();
  const blind = taskSpec.blind();
  const constantId = `always_${taskSpec.constant}`;
  const constant = { decide: () => ({ actionId: taskSpec.constant, reasoning: `Constant forecast: ${taskSpec.constant}.` }) };
  const conditions = [];
  for (const id of [...selected, constantId]) {
    const isConstant = id === constantId;
    const ruleAccess = isConstant ? 'infer' : id;
    const selectedPolicy = isConstant ? constant : policy ?? (id === 'ablated' ? blind : reference);
    const pairs = [];
    for (const { pairIndex, changedCheckpoints, tasks } of batch) {
      const sides = [];
      for (const [index, task] of tasks[ruleAccess].entries()) {
        if (signal?.aborted) throw new ModelError('The matched run was cancelled.', 'CANCELLED');
        const result = await attempt(task, selectedPolicy, 1, { signal });
        if (signal?.aborted) throw new ModelError('The matched run was cancelled.', 'CANCELLED');
        sides.push({ side: SIDES[index], queryCount: 6, brief: task.public, attempt: result });
      }
      pairs.push({ pairIndex, changedCheckpoints, sides });
    }
    conditions.push({ id, ruleAccess, policyKind: isConstant ? 'constant' : options.policyKind, summary: summarizeMatchedPairs(pairs), pairs });
  }
  const sources = await Promise.all(['matched-dynamics.mjs', 'matched-scoring.mjs', 'coupled-tasks.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const after = usageSnapshot(policy);
  const report = {
    schemaVersion: 1, benchmarkVersion: BENCHMARK_VERSION, kind: 'matched_dynamics',
    status: conditions.some(condition => condition.summary.incompletePairs) ? 'completed_with_errors' : 'completed',
    options,
    provenance: { sourceHash: hash([await sourceFingerprint(), ...sources.map(source => source.replace(/\r\n/g, '\n'))]), runtime: process.version, platform: process.platform },
    protocol: { task: options.taskId, split: 'development', pairCount: batch.length, forecastQueriesPerCase: 6,
      primaryMeasure: 'Both forecasts correct at horizons whose actual state differs across the paired mechanisms.',
      controls: `Given supplies the mechanism. Ablated removes calibration states while retaining the realized-state scoring key. The constant predictor always selects ${taskSpec.constant}.`,
      coverage: 'Incomplete pairs contribute no paired accuracy. Forecast accuracy counts only completed sides.',
      maxModelCalls: policy ? maxModelCalls : 0,
      limitations: 'All pairs use one public mechanism family and reuse mechanisms. The pairs and controls are descriptive, with no held-out study or repeated model trials.' },
    conditions,
    costs: { modelUsage: after ? { ...after, ...usageDelta(before, after) } : null },
  };
  return { ...report, reportHash: hash(report) };
}
