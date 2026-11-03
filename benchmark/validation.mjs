/** Fixed dynamics-learning controls; historical matrices remain explicit suites. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BENCHMARK_VERSION, createTask, runBenchmark, validateBenchmarkOptions } from './index.mjs';
import { runValidation as runStateValidation, validateValidationOptions as validateStateOptions } from './state-validation.mjs';
import { runValidation as runLegacyValidation, validateValidationOptions as validateLegacyOptions,
  pairedCase, summarizePair, aggregateCosts } from './legacy-validation.mjs';
import { ModelError } from '../model-client.mjs';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONDITIONS = [
  { id: 'base_infer', variant: 'base', ruleAccess: 'infer' },
  { id: 'shifted_infer', variant: 'temporal_shift', ruleAccess: 'infer' },
  { id: 'base_given', variant: 'base', ruleAccess: 'given' },
  { id: 'shifted_given', variant: 'temporal_shift', ruleAccess: 'given' },
];
const PAIRS = [
  { id: 'timing_infer', factor: 'temporal_relation', control: 'base_infer', treatment: 'shifted_infer' },
  { id: 'timing_given', factor: 'temporal_relation', control: 'base_given', treatment: 'shifted_given' },
  { id: 'supplied_rules_base', factor: 'mechanism_information', control: 'base_infer', treatment: 'base_given' },
  { id: 'supplied_rules_shifted', factor: 'mechanism_information', control: 'shifted_infer', treatment: 'shifted_given' },
];

export function validateValidationOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Provide validation options as an object.');
  if (input.suite === 'temporal') return validateStateOptions(input);
  if (input.suite === 'legacy') return validateLegacyOptions(input);
  const allowed = new Set(['suite', 'seed', 'seedCount', 'attempts', 'analysisBudget', 'policyKind', 'model', 'strategies', 'split']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new RangeError(`Unknown validation option: ${key}.`);
  if (input.split != null && input.split !== 'development') throw new RangeError('The first dynamics validation task has only a development split.');
  const { taskId, family, delay, stateMode, interference, variant, ruleAccess, ...options } = validateBenchmarkOptions(input);
  const maxSeeds = ['reference', 'custom'].includes(options.policyKind) ? 10 : 3;
  if (options.seedCount > maxSeeds) throw new RangeError(`Validation seedCount must be between 1 and ${maxSeeds}.`);
  return options;
}

const data = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));
function auditPair(left, right, factor) {
  const a = createTask(left), b = createTask(right);
  if (factor === 'temporal_relation' && JSON.stringify(a.public) !== JSON.stringify(b.public)) throw new Error('A timing pair changed the public rules.');
  let horizonEdits = 0;
  for (let i = 0; i < a.definitions.length; i++) {
    const x = a.definitions[i], y = b.definitions[i];
    if (JSON.stringify([x.t, x.checkpointId, x.phase, x.actions]) !== JSON.stringify([y.t, y.checkpointId, y.phase, y.actions])) throw new Error('A learning control changed its schedule or choices.');
    if (x.observation === y.observation) continue;
    if (factor !== 'temporal_relation' || x.phase !== 'forecast') throw new Error('A control changed its calibration or relevant input records.');
    const m = data(x.observation), n = data(y.observation);
    if (m.horizon === n.horizon) throw new Error('A timing control changed a non-horizon field.');
    delete m.horizon; delete n.horizon;
    if (JSON.stringify(m) !== JSON.stringify(n) || x.observation.split('\n').slice(1).join('\n') !== y.observation.split('\n').slice(1).join('\n')) throw new Error('A timing control changed non-temporal facts.');
    horizonEdits++;
  }
  const keys = a.answerKey(), other = b.answerKey();
  const changedCheckpoints = keys.filter((k, i) => k.answerId !== other[i].answerId).map(k => k.checkpointId);
  if (factor === 'temporal_relation' ? horizonEdits !== 1 || !changedCheckpoints.length : changedCheckpoints.length !== 0) throw new Error('A learning control failed its declared invariant.');
  return { taskId: left.taskId, seed: left.seed, changedQueryCount: changedCheckpoints.length, changedCheckpoints };
}

function pairedAnswers(control, treatment, strategy, audit, factor) {
  const row = pairedCase(control, treatment, strategy);
  const a = control.runs.find(run => run.strategy === strategy).attempts[0];
  const b = treatment.runs.find(run => run.strategy === strategy).attempts[0];
  const temporal = factor === 'temporal_relation';
  const both = temporal && row.firstComplete ? audit.changedCheckpoints.filter(id => a.outcome.checks.some(c => c.id === id && c.passed) && b.outcome.checks.some(c => c.id === id && c.passed)).length : null;
  return { ...row, requiredFlipQueries: temporal ? audit.changedQueryCount : 0,
    bothCorrectFlipQueries: both, pairedTemporalAccuracy: temporal && row.firstComplete ? both / audit.changedQueryCount : null };
}

/** Forecasts in each condition are frozen independently, before any scoring. */
export async function runValidation(input = {}, { policy, policyFactory, signal } = {}) {
  if (input?.suite === 'temporal') return runStateValidation(input, { policy, policyFactory, signal });
  if (input?.suite === 'legacy') return runLegacyValidation(input, { policy, policyFactory, signal });
  let options = validateValidationOptions(input);
  if (policy && policyFactory) throw new RangeError('Supply policy or policyFactory, not both.');
  if ((policy || policyFactory) && input.policyKind == null) options = validateValidationOptions({ ...input, policyKind: ['openai', 'compatible'].includes(policy?.kind) ? policy.kind : 'custom' });
  if ((policy || policyFactory) && options.policyKind === 'reference') throw new RangeError('Injected validation policies must be labeled custom or a model provider, not reference.');
  if (!policy && !policyFactory && options.policyKind !== 'reference') throw new RangeError('A non-reference validation requires an explicit policy.');
  if (policyFactory && typeof policyFactory !== 'function') throw new RangeError('policyFactory must be a function.');
  const conditions = [];
  for (const condition of CONDITIONS) {
    if (signal?.aborted) throw new ModelError('The validation was cancelled.', 'CANCELLED');
    const single = { ...options, ...condition, taskId: 'delayed_commit' };
    delete single.id;
    const selectedPolicy = policyFactory ? await policyFactory({ condition: clone(condition), options: clone(single) }) : policy;
    if (policyFactory && !selectedPolicy) throw new RangeError('policyFactory must return a policy for every condition.');
    const report = await runBenchmark(single, { policy: selectedPolicy, signal });
    conditions.push({ ...condition, taskId: 'delayed_commit', family: 'dynamics_learning', options: single, report });
  }
  const pairs = PAIRS.map(pair => {
    const control = conditions.find(c => c.id === pair.control), treatment = conditions.find(c => c.id === pair.treatment);
    const audits = control.report.cases.map(c => auditPair({ ...control.options, seed: c.seed }, { ...treatment.options, seed: c.seed }, pair.factor));
    const caseDeltas = control.report.cases.flatMap((c, i) => {
      const counterpart = treatment.report.cases.find(t => t.taskId === c.taskId && t.seed === c.seed);
      if (!counterpart) throw new Error('Matched validation cases are missing.');
      return options.strategies.map(strategy => pairedAnswers(c, counterpart, strategy, audits[i], pair.factor));
    });
    const summary = summarizePair(caseDeltas, options.strategies).map(row => {
      const complete = caseDeltas.filter(d => d.strategy === row.strategy && d.firstComplete);
      const requiredFlipQueries = complete.reduce((n, d) => n + d.requiredFlipQueries, 0);
      const bothCorrectFlipQueries = pair.factor === 'temporal_relation' ? complete.reduce((n, d) => n + d.bothCorrectFlipQueries, 0) : null;
      return { ...row, requiredFlipQueries, bothCorrectFlipQueries, pairedTemporalAccuracy: requiredFlipQueries ? bothCorrectFlipQueries / requiredFlipQueries : null };
    });
    return { ...pair, family: 'dynamics_learning', taskId: 'delayed_commit', deltaDirection: 'treatment minus control',
      temporalNecessity: { onlyTemporalMetadataChanged: pair.factor === 'temporal_relation' ? true : null,
        answerChangeExpected: pair.factor === 'temporal_relation', changedQueriesPerCase: audits }, caseDeltas, summary };
  });
  const sources = await Promise.all(['validation.mjs', 'legacy-validation.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const sourceHashes = [...new Set(conditions.map(c => c.report.provenance.sourceHash))];
  const report = { schemaVersion: 3, benchmarkVersion: BENCHMARK_VERSION, kind: 'temporal_validation',
    status: conditions.some(c => c.report.status !== 'completed') ? 'completed_with_errors' : 'completed', options,
    provenance: { sourceHash: hash({ validationSource: sources.map(s => s.replace(/\r\n/g, '\n')), benchmarkSourceHashes: sourceHashes }), benchmarkSourceHashes: sourceHashes, runtime: process.version, platform: process.platform },
    protocol: { conditionCount: 4, focus: 'dynamics_learning_and_prediction', pairedSeeds: true,
      sharedFirstAttemptWithinEachCondition: true, sharedFirstAttemptAcrossConditions: false,
      conditionMemory: 'Each condition is a fresh unassisted task. No condition sees any other condition or resolved forecast.',
      policyLifecycle: policyFactory ? 'fresh_policy_per_condition' : 'shared_stateless_adapter',
      matchedFactors: ['infer mechanism from calibration versus explicitly supplied mechanism', 'one changed forecast horizon with unchanged inputs'],
      primaryMeasure: 'All unseen-run state forecasts; supplied-rule accuracy is a separate control for applying known dynamics.',
      temporalNecessity: 'The evaluator checks one changed query horizon with a required answer flip. This secondary timing control alone does not establish learning: before-all and after-all outcomes can be invariant across mechanisms.',
      pairing: 'Same mechanism, calibration runs, target input plan, options and model settings within each pair. No cross-condition memory.',
      incompletePairs: 'Incomplete pairs retain null paired metrics and deltas with explicit coverage and error counts.',
      recoveryTested: false, deltaDirection: 'treatment minus control' },
    conditions, pairs,
    summary: conditions.flatMap(condition => condition.report.summary.filter(row => row.family === condition.family).map(row => ({ conditionId: condition.id, ...clone(row) }))),
    costs: aggregateCosts(conditions),
    limitations: ['A first deterministic, public task family with six candidate mechanisms, not broad forecasting ability, a hidden test set or a novelty claim.',
      'All forecast inputs are specified; outcomes of their execution are hidden until predictions are committed. This does not predict unknown external actions.',
      'The exact reference learner enumerates candidates using only calibration evidence; its performance is not language-model evidence.',
      'The supplied-rule contrast helps diagnose learning versus applying a mechanism. Stochastic model calls and one sample cannot establish causal attribution of an accuracy gap.',
      'Timing-pair correctness is a secondary control; use all forecast queries to evaluate discrimination among learned mechanisms.',
      'These overlapping contrasts are descriptive and must not be pooled as independent observations. Errors and missing forecasts remain visible.',
      'No same-instance assisted recovery is allowed in this forecasting task. Pincer and reflection require a future fresh-episode protocol before a forecasting comparison.'],
  };
  return { ...report, reportHash: hash(report) };
}
