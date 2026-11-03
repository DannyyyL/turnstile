/** Temporal necessity pairs: only a timestamp changes, and an answer must flip. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BENCHMARK_VERSION, TEMPORAL_TASKS, createTask, runBenchmark, validateBenchmarkOptions } from './index.mjs';
import { runValidation as runLegacyValidation, validateValidationOptions as validateLegacyOptions,
  pairedCase, summarizePair, aggregateCosts } from './legacy-validation.mjs';
import { ModelError } from '../model-client.mjs';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONDITIONS = [
  { id: 'base_clean', variant: 'base', interference: 0 },
  { id: 'shifted_clean', variant: 'temporal_shift', interference: 0 },
  { id: 'base_distracted', variant: 'base', interference: 3 },
  { id: 'shifted_distracted', variant: 'temporal_shift', interference: 3 },
];
const PAIRS = [
  { id: 'temporal_clean', factor: 'temporal_relation', control: 'base_clean', treatment: 'shifted_clean' },
  { id: 'temporal_distracted', factor: 'temporal_relation', control: 'base_distracted', treatment: 'shifted_distracted' },
  { id: 'noise_base', factor: 'irrelevant_observations', control: 'base_clean', treatment: 'base_distracted' },
  { id: 'noise_shifted', factor: 'irrelevant_observations', control: 'shifted_clean', treatment: 'shifted_distracted' },
];

export function validateValidationOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Provide validation options as an object.');
  if (input.suite === 'legacy') return validateLegacyOptions(input);
  if (input.suite != null && input.suite !== 'temporal') throw new RangeError('Historical state validation requires suite temporal.');
  const allowed = new Set(['suite', 'seed', 'seedCount', 'attempts', 'analysisBudget', 'policyKind', 'model', 'strategies', 'split']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new RangeError(`Unknown validation option: ${key}.`);
  const split = input.split ?? 'development';
  if (!['development', 'evaluation'].includes(split)) throw new RangeError('Validation split must be development or evaluation.');
  const { taskId, family, delay, stateMode, interference, variant, ruleAccess, ...options } = validateBenchmarkOptions({ ...input, suite: 'temporal', split, analysisBudget: input.analysisBudget ?? 4 });
  const maxSeeds = ['reference', 'custom'].includes(options.policyKind) ? 10 : 3;
  if (options.seedCount > maxSeeds) throw new RangeError(`Validation seedCount must be between 1 and ${maxSeeds}.`);
  if (options.attempts > 2) throw new RangeError('Validation attempts must be 1 or 2.');
  return options;
}

const data = observation => JSON.parse(observation.split('\n')[0].slice(observation.indexOf(': ') + 2));
function auditPair(left, right, factor) {
  const a = createTask(left), b = createTask(right);
  if (JSON.stringify(a.public) !== JSON.stringify(b.public)) throw new Error('A matched pair changed its public rules.');
  const changedFields = [];
  for (let i = 0; i < a.definitions.length; i++) {
    const x = a.definitions[i], y = b.definitions[i];
    if (JSON.stringify([x.t, x.checkpointId, x.actions]) !== JSON.stringify([y.t, y.checkpointId, y.actions])) throw new Error('A matched pair changed its schedule or choices.');
    if (factor === 'temporal_relation' && x.observation !== y.observation) {
      const m = data(x.observation), n = data(y.observation);
      if (m.effectiveTime === n.effectiveTime) throw new Error('A temporal pair changed a non-effective-time field.');
      delete m.effectiveTime; delete n.effectiveTime;
      if (JSON.stringify(m) !== JSON.stringify(n) || x.observation.split('\n').slice(1).join('\n') !== y.observation.split('\n').slice(1).join('\n')) throw new Error('A temporal pair changed non-temporal facts.');
      changedFields.push(x.checkpointId);
    } else if (factor === 'irrelevant_observations' && x.observation.split('\n')[0] !== y.observation.split('\n')[0]) throw new Error('An interference pair changed its relevant evidence.');
  }
  const keys = a.answerKey(), other = b.answerKey();
  const changedCheckpoints = keys.filter((k, i) => k.answerId !== other[i].answerId).map(k => k.checkpointId);
  if (factor === 'temporal_relation' ? changedFields.length !== 1 || !changedCheckpoints.length : changedCheckpoints.length !== 0) throw new Error('A matched pair failed its temporal-necessity invariant.');
  return { taskId: left.taskId, seed: left.seed, changedQueryCount: changedCheckpoints.length, changedCheckpoints };
}

function pairedAnswers(control, treatment, strategy, audit, factor) {
  const row = pairedCase(control, treatment, strategy);
  const a = control.runs.find(run => run.strategy === strategy).attempts[0];
  const b = treatment.runs.find(run => run.strategy === strategy).attempts[0];
  const count = audit.changedQueryCount;
  const bothCorrect = row.firstComplete ? audit.changedCheckpoints.filter(id => a.outcome.checks.some(c => c.id === id && c.passed) && b.outcome.checks.some(c => c.id === id && c.passed)).length : null;
  const comparable = factor === 'temporal_relation';
  return { ...row, requiredFlipQueries: comparable ? count : 0, bothCorrectFlipQueries: comparable ? bothCorrect : null,
    pairedTemporalAccuracy: comparable && row.firstComplete && count ? bothCorrect / count : null };
}

/** Each condition has fresh task state and no access to other conditions. */
export async function runValidation(input = {}, { policy, policyFactory, signal } = {}) {
  if (input?.suite === 'legacy') return runLegacyValidation(input, { policy, policyFactory, signal });
  let options = validateValidationOptions(input);
  if (policy && policyFactory) throw new RangeError('Supply policy or policyFactory, not both.');
  if ((policy || policyFactory) && input.policyKind == null) options = validateValidationOptions({ ...input, policyKind: ['openai', 'compatible'].includes(policy?.kind) ? policy.kind : 'custom' });
  if ((policy || policyFactory) && options.policyKind === 'reference') throw new RangeError('Injected validation policies must be labeled custom or a model provider, not reference.');
  if (!policy && !policyFactory && options.policyKind !== 'reference') throw new RangeError('A non-reference validation requires an explicit policy.');
  if (policyFactory && typeof policyFactory !== 'function') throw new RangeError('policyFactory must be a function.');
  const metadata = TEMPORAL_TASKS.find(task => task.split === options.split);
  const conditions = [];
  for (const condition of CONDITIONS) {
    if (signal?.aborted) throw new ModelError('The validation was cancelled.', 'CANCELLED');
    const single = { ...options, ...condition, taskId: metadata.id };
    delete single.id;
    const selectedPolicy = policyFactory ? await policyFactory({ condition: clone(condition), options: clone(single) }) : policy;
    if (policyFactory && !selectedPolicy) throw new RangeError('policyFactory must return a policy for every condition.');
    const report = await runBenchmark(single, { policy: selectedPolicy, signal });
    conditions.push({ ...condition, taskId: metadata.id, family: metadata.family, options: single, report });
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
    return { ...pair, family: metadata.family, taskId: metadata.id, deltaDirection: 'treatment minus control',
      temporalNecessity: { onlyTemporalMetadataChanged: pair.factor === 'temporal_relation' ? true : null,
        answerChangeExpected: pair.factor === 'temporal_relation', changedQueriesPerCase: audits }, caseDeltas, summary };
  });
  const sources = await Promise.all(['state-validation.mjs', 'legacy-validation.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const sourceHashes = [...new Set(conditions.map(c => c.report.provenance.sourceHash))];
  const report = { schemaVersion: 2, benchmarkVersion: BENCHMARK_VERSION, kind: 'temporal_validation',
    status: conditions.some(c => c.report.status !== 'completed') ? 'completed_with_errors' : 'completed', options,
    provenance: { sourceHash: hash({ validationSource: sources.map(s => s.replace(/\r\n/g, '\n')), benchmarkSourceHashes: sourceHashes }), benchmarkSourceHashes: sourceHashes, runtime: process.version, platform: process.platform },
    protocol: { conditionCount: 4, focus: 'online_temporal_state_reconstruction', pairedSeeds: true,
      sharedFirstAttemptWithinEachCondition: true, sharedFirstAttemptAcrossConditions: false,
      conditionMemory: 'Each condition starts with a fresh unassisted attempt. Only retries within that condition receive permitted assistance.',
      policyLifecycle: policyFactory ? 'fresh_policy_per_condition' : 'shared_stateless_adapter',
      matchedFactors: ['one effective timestamp with a required correct-answer flip', 'irrelevant observations with unchanged correct answers'],
      temporalNecessity: 'The evaluator verifies that exactly one effective timestamp changes, all non-temporal facts and choices remain fixed, and at least one correct answer flips. Paired temporal accuracy requires both answers correct on those queries.',
      pairing: 'Same template, seed, action options and model settings within each pair. No cross-condition memory.',
      incompletePairs: 'Incomplete pairs remain in error and coverage counts; paired accuracy and deltas are null unless both first attempts completed.',
      recoveryTested: options.attempts > 1, deltaDirection: 'treatment minus control' },
    conditions, pairs,
    summary: conditions.flatMap(condition => condition.report.summary.filter(row => row.family === condition.family).map(row => ({ conditionId: condition.id, ...clone(row) }))),
    costs: aggregateCosts(conditions),
    limitations: ['A narrow diagnostic of effective-time versus received-time reasoning; temporal QA and state tracking are established benchmark areas, not novelty claims.',
      'Two public task templates with randomized labels and choices. Seeds are variations of templates, not independent domains or a hidden test set.',
      'Primary results are unassisted first-attempt task success, query accuracy, and correctness on both members of answer-changing temporal pairs. Recovery is secondary.',
      'Deterministic reference policies verify the harness only, not language-model capability.',
      'Model randomness can change responses between matched conditions. No confidence interval, ranking or statistical significance is inferred.',
      'The four paired contrasts overlap cases and must not be pooled as independent samples.',
      'Pincer versus reflection combines traversal and delivery differences; additional ablations are needed to attribute effects.'],
  };
  return { ...report, reportHash: hash(report) };
}
