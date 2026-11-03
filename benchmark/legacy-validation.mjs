/** Matched development controls. Conditions change one documented factor at a time. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BENCHMARK_VERSION, TASKS, runBenchmark, validateBenchmarkOptions } from './index.mjs';
import { ModelError } from '../model-client.mjs';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const families = ['delayed_consequences', 'temporal_state_tracking'];
const COUNTER_FIELDS = ['calls', 'inputTokens', 'outputTokens', 'totalTokens', 'unreportedUsageCalls', 'reportedCostUSD', 'unreportedCostResponses'];

export function validateValidationOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Provide validation options as an object.');
  const allowed = new Set(['suite', 'seed', 'seedCount', 'attempts', 'analysisBudget', 'policyKind', 'model', 'strategies', 'split']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new RangeError(`Unknown validation option: ${key}.`);
  if (input.suite != null && input.suite !== 'legacy') throw new RangeError('Legacy validation requires suite legacy.');
  const split = input.split ?? 'development';
  if (!['development', 'evaluation'].includes(split)) throw new RangeError('Validation split must be development or evaluation.');
  const { taskId, family, delay, stateMode, interference, variant, ruleAccess, ...options } = validateBenchmarkOptions({
    suite: 'legacy',
    seed: input.seed, seedCount: input.seedCount, attempts: input.attempts ?? 1,
    analysisBudget: input.analysisBudget ?? 4, policyKind: input.policyKind,
    model: input.model, strategies: input.strategies,
  });
  const maxSeeds = ['reference', 'custom'].includes(options.policyKind) ? 10 : 3;
  if (options.seedCount > maxSeeds) throw new RangeError(`Validation seedCount must be between 1 and ${maxSeeds}.`);
  if (options.attempts > 2) throw new RangeError('Validation attempts must be 1 or 2.');
  // The matrix itself is fixed: callers cannot quietly change more factors.
  return { ...options, split };
}

function matrix(split) {
  const taskFor = family => {
    const candidates = TASKS.filter(task => task.suite === 'legacy' && task.family === family && (task.split ?? 'development') === split);
    const canonical = family === 'delayed_consequences' ? 'temporal_release' : 'state_ledger';
    const selected = candidates.find(task => task.id === canonical) ?? candidates[0];
    if (!selected) throw new RangeError(`No ${family} task is available in the ${split} split.`);
    return selected.id;
  };
  const delayed = taskFor(families[0]), state = taskFor(families[1]);
  return [
    { id: 'delay_short_clean', family: families[0], taskId: delayed, delay: 0, stateMode: 'temporal', interference: 0 },
    { id: 'delay_long_clean', family: families[0], taskId: delayed, delay: 7, stateMode: 'temporal', interference: 0 },
    { id: 'delay_short_distracted', family: families[0], taskId: delayed, delay: 0, stateMode: 'temporal', interference: 3 },
    { id: 'delay_long_distracted', family: families[0], taskId: delayed, delay: 7, stateMode: 'temporal', interference: 3 },
    { id: 'state_updates_clean', family: families[1], taskId: state, delay: 7, stateMode: 'updates', interference: 0 },
    { id: 'state_temporal_clean', family: families[1], taskId: state, delay: 7, stateMode: 'temporal', interference: 0 },
    { id: 'state_updates_distracted', family: families[1], taskId: state, delay: 7, stateMode: 'updates', interference: 3 },
    { id: 'state_temporal_distracted', family: families[1], taskId: state, delay: 7, stateMode: 'temporal', interference: 3 },
  ];
}

const PAIRS = [
  { id: 'delay_without_interference', factor: 'consequence_delay', control: 'delay_short_clean', treatment: 'delay_long_clean' },
  { id: 'delay_with_interference', factor: 'consequence_delay', control: 'delay_short_distracted', treatment: 'delay_long_distracted' },
  { id: 'interference_at_short_delay', factor: 'irrelevant_observations', control: 'delay_short_clean', treatment: 'delay_short_distracted' },
  { id: 'interference_at_long_delay', factor: 'irrelevant_observations', control: 'delay_long_clean', treatment: 'delay_long_distracted' },
  { id: 'temporal_rules_without_interference', factor: 'invalidation_and_expiry', control: 'state_updates_clean', treatment: 'state_temporal_clean' },
  { id: 'temporal_rules_with_interference', factor: 'invalidation_and_expiry', control: 'state_updates_distracted', treatment: 'state_temporal_distracted' },
  { id: 'interference_with_updates', factor: 'irrelevant_observations', control: 'state_updates_clean', treatment: 'state_updates_distracted' },
  { id: 'interference_with_temporal_rules', factor: 'irrelevant_observations', control: 'state_temporal_clean', treatment: 'state_temporal_distracted' },
];

export function pairedCase(control, treatment, strategy) {
  const a = control.runs.find(run => run.strategy === strategy), b = treatment.runs.find(run => run.strategy === strategy);
  const firstComplete = a.attempts[0].status === 'completed' && b.attempts[0].status === 'completed';
  const finalComplete = a.status === 'completed' && b.status === 'completed';
  const selected = run => ({ status: run.status, firstAttemptStatus: run.attempts[0].status,
    firstAttemptSuccess: run.metrics.firstAttemptSuccess, firstAttemptScore: run.metrics.firstAttemptScore,
    finalSuccess: run.metrics.finalSuccess, finalScore: run.metrics.finalScore,
    recoveryEligible: run.metrics.recoveryEligible, recoveredAfterFailure: run.metrics.recoveredAfterFailure, error: run.metrics.error });
  return { taskId: control.taskId, seed: control.seed, strategy,
    control: selected(a), treatment: selected(b), firstComplete, finalComplete,
    firstAttemptScoreDelta: firstComplete ? b.metrics.firstAttemptScore - a.metrics.firstAttemptScore : null,
    firstAttemptSuccessDelta: firstComplete ? Number(b.metrics.firstAttemptSuccess) - Number(a.metrics.firstAttemptSuccess) : null,
    finalScoreDelta: finalComplete ? b.metrics.finalScore - a.metrics.finalScore : null,
    finalSuccessDelta: finalComplete ? Number(b.metrics.finalSuccess) - Number(a.metrics.finalSuccess) : null };
}

export function summarizePair(deltas, strategies) {
  const mean = (rows, field) => rows.length ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length : null;
  return strategies.map(strategy => {
    const rows = deltas.filter(row => row.strategy === strategy), first = rows.filter(row => row.firstComplete), final = rows.filter(row => row.finalComplete);
    return { strategy, pairedCases: rows.length, completeFirstPairs: first.length, incompleteFirstPairs: rows.length - first.length,
      completeFinalPairs: final.length, incompleteFinalPairs: rows.length - final.length,
      meanFirstAttemptScoreDelta: mean(first, 'firstAttemptScoreDelta'), firstAttemptSuccessRateDifference: mean(first, 'firstAttemptSuccessDelta'),
      meanFinalScoreDelta: mean(final, 'finalScoreDelta'), finalSuccessRateDifference: mean(final, 'finalSuccessDelta'),
      controlOnlyFirstSuccesses: first.filter(row => row.control.firstAttemptSuccess && !row.treatment.firstAttemptSuccess).length,
      treatmentOnlyFirstSuccesses: first.filter(row => !row.control.firstAttemptSuccess && row.treatment.firstAttemptSuccess).length,
      bothFirstSuccesses: first.filter(row => row.control.firstAttemptSuccess && row.treatment.firstAttemptSuccess).length,
      neitherFirstSuccesses: first.filter(row => !row.control.firstAttemptSuccess && !row.treatment.firstAttemptSuccess).length,
      controlErrors: rows.filter(row => row.control.error).length, treatmentErrors: rows.filter(row => row.treatment.error).length };
  });
}

export function aggregateCosts(conditions) {
  const sum = field => conditions.every(c => Number.isFinite(c.report.costs[field])) ? conditions.reduce((n, c) => n + c.report.costs[field], 0) : null;
  const usage = conditions.map(c => c.report.costs.modelUsage);
  const modelUsage = usage.every(u => u === null) ? null : {
    provider: usage.find(u => u)?.provider ?? null, model: usage.find(u => u)?.model ?? null,
    ...Object.fromEntries(COUNTER_FIELDS.map(field => [field, usage.every(u => Number.isFinite(u?.[field])) ? usage.reduce((n, u) => n + u[field], 0) : null])),
  };
  return { physicalForwardActions: sum('physicalForwardActions'), physicalForwardEffort: sum('physicalForwardEffort'),
    physicalPolicyDecisions: sum('physicalPolicyDecisions'), physicalAutomaticActions: sum('physicalAutomaticActions'),
    replayActions: sum('replayActions'), replayEffort: sum('replayEffort'), modelUsage };
}

/**
 * A model adapter must be stateless apart from usage counters. A policyFactory
 * can create an independent adapter for each condition; it must keep settings
 * fixed across conditions. No condition label is placed in actor contexts.
 */
export async function runValidation(input = {}, { policy, policyFactory, signal } = {}) {
  let options = validateValidationOptions(input);
  if (policy && policyFactory) throw new RangeError('Supply policy or policyFactory, not both.');
  if ((policy || policyFactory) && input.policyKind == null) options = validateValidationOptions({ ...input, policyKind: ['openai', 'compatible'].includes(policy?.kind) ? policy.kind : 'custom' });
  if ((policy || policyFactory) && options.policyKind === 'reference') throw new RangeError('Injected validation policies must be labeled custom or a model provider, not reference.');
  if (!policy && !policyFactory && options.policyKind !== 'reference') throw new RangeError('A non-reference validation requires an explicit policy.');
  if (policyFactory && typeof policyFactory !== 'function') throw new RangeError('policyFactory must be a function.');
  const conditions = [];
  for (const condition of matrix(options.split)) {
    if (signal?.aborted) throw new ModelError('The validation was cancelled.', 'CANCELLED');
    const single = { suite: 'legacy', taskId: condition.taskId, seed: options.seed, seedCount: options.seedCount, attempts: options.attempts,
      analysisBudget: options.analysisBudget, policyKind: options.policyKind, model: options.model, strategies: [...options.strategies], split: options.split,
      delay: condition.delay, stateMode: condition.stateMode, interference: condition.interference };
    const selectedPolicy = policyFactory ? await policyFactory({ condition: clone(condition), options: clone(single) }) : policy;
    if (policyFactory && !selectedPolicy) throw new RangeError('policyFactory must return a policy for every condition.');
    const report = await runBenchmark(single, { policy: selectedPolicy, signal });
    conditions.push({ ...clone(condition), options: clone(single), report });
  }
  const pairs = PAIRS.map(pair => {
    const control = conditions.find(c => c.id === pair.control), treatment = conditions.find(c => c.id === pair.treatment);
    const caseDeltas = control.report.cases.flatMap(c => {
      const counterpart = treatment.report.cases.find(t => t.taskId === c.taskId && t.seed === c.seed);
      if (!counterpart) throw new Error('Matched validation cases are missing.');
      return options.strategies.map(strategy => pairedCase(c, counterpart, strategy));
    });
    return { ...clone(pair), family: control.family, taskId: control.taskId, deltaDirection: 'treatment minus control', caseDeltas,
      summary: summarizePair(caseDeltas, options.strategies) };
  });
  const validationSource = (await readFile(new URL(import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const sourceHashes = [...new Set(conditions.map(c => c.report.provenance.sourceHash))];
  const report = { schemaVersion: 1, benchmarkVersion: BENCHMARK_VERSION, kind: 'temporal_validation',
    status: conditions.some(c => c.report.status !== 'completed') ? 'completed_with_errors' : 'completed', options,
    provenance: { sourceHash: hash({ validationSource, benchmarkSourceHashes: sourceHashes }), benchmarkSourceHashes: sourceHashes, runtime: process.version, platform: process.platform },
    protocol: { conditionCount: 8, pairedSeeds: true, sharedFirstAttemptWithinEachCondition: true, sharedFirstAttemptAcrossConditions: false,
      conditionMemory: 'Each condition starts with a fresh unassisted attempt. Only retries within that condition receive permitted assistance.',
      policyLifecycle: policyFactory ? 'fresh_policy_per_condition' : 'shared_stateless_adapter',
      matchedFactors: ['consequence delay 0 versus 7', 'irrelevant-observation interference 0 versus 3', 'updates without invalidation/expiry versus full temporal rules'],
      pairing: 'Same task template, seed, action options, model settings, retry allowance and replay budget within each pair; one named factor differs.',
      incompletePairs: 'Error cases remain in reports and error counts; paired score/success deltas are null unless both relevant runs completed.',
      recoveryTested: options.attempts > 1, deltaDirection: 'treatment minus control' },
    conditions, pairs,
    summary: conditions.flatMap(condition => condition.report.summary.filter(row => row.family === condition.family).map(row => ({ conditionId: condition.id, ...clone(row) }))),
    costs: aggregateCosts(conditions),
    limitations: ['These public matched controls test the harness and support descriptive comparisons, not a model ranking or temporal-reasoning validity claim.',
      'Reference policies are deterministic fixtures, not language models; their results cannot establish model-level efficacy.',
      'The updates control disables assignment retractions or reservation releases and removes expiry; it retains effective-time selection and does not isolate arrival order.',
      'Conditions have independent model-generated source attempts. Paired task seeds do not make stochastic model responses identical.',
      'No confidence intervals, statistical significance or effect attribution is inferred. Pair summaries overlap cases and must not be pooled as independent samples.',
      'The public evaluation split changes task structure but is not secret or contamination-proof.',
      'Recovery results, when requested, retain the benchmark limitations: unmatched total compute and combined traversal/delivery effects.'],
  };
  return { ...report, reportHash: hash(report) };
}
