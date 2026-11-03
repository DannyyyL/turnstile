import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as yieldToIO } from 'node:timers/promises';
import { TASKS, ACTIVE_TASKS, DYNAMICS_TASKS, TEMPORAL_TASKS, LEGACY_TASKS, createTask } from './tasks.mjs';
import { createDynamicsReferencePolicy } from './dynamics-policy.mjs';
import { ModelError } from '../model-client.mjs';
export { TASKS, ACTIVE_TASKS, DYNAMICS_TASKS, TEMPORAL_TASKS, LEGACY_TASKS, createTask };

export const BENCHMARK_VERSION = '0.5.0';
export const STRATEGIES = [
  { id: 'forward_only', analysis: null, delivery: 'none', memory: 'fresh' },
  { id: 'trace_memory', analysis: null, delivery: 'attempt_start', memory: 'all_completed_attempts' },
  { id: 'reflection', analysis: 'forward', delivery: 'attempt_start', memory: 'verified_notes' },
  { id: 'temporal_pincer', analysis: 'backward', delivery: 'matching_checkpoint', memory: 'verified_notes' },
];
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (value, name, fallback, min, max) => {
  value ??= fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
};

export function validateBenchmarkOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Provide benchmark options as an object.');
  const allowed = new Set(['suite', 'variant', 'ruleAccess', 'taskId', 'family', 'seed', 'seedCount', 'attempts', 'delay', 'analysisBudget', 'strategies', 'policyKind', 'model', 'split', 'stateMode', 'interference']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new RangeError(`Unknown benchmark option: ${key}.`);
  const policyKind = input.policyKind ?? 'reference';
  if (!['reference', 'openai', 'compatible', 'custom'].includes(policyKind)) throw new RangeError('Unknown benchmark policyKind.');
  if (input.taskId != null && !TASKS.some(t => t.id === input.taskId)) throw new RangeError('Unknown benchmark taskId.');
  const suite = input.suite ?? TASKS.find(t => t.id === input.taskId)?.suite ?? 'dynamics';
  if (!['dynamics', 'temporal', 'legacy'].includes(suite)) throw new RangeError('suite must be dynamics, temporal or legacy.');
  const registry = suite === 'dynamics' ? DYNAMICS_TASKS : suite === 'temporal' ? TEMPORAL_TASKS : LEGACY_TASKS;
  if (input.taskId != null && !registry.some(t => t.id === input.taskId)) throw new RangeError('taskId does not belong to the selected suite.');
  if (input.family != null && !registry.some(t => t.family === input.family)) throw new RangeError('family does not belong to the selected suite; planning tasks require suite legacy.');
  if (input.family != null && !TASKS.some(t => t.family === input.family)) throw new RangeError('Unknown benchmark family.');
  if (input.taskId && input.family && !TASKS.some(t => t.id === input.taskId && t.family === input.family)) throw new RangeError('taskId does not belong to family.');
  const split = input.split ?? 'development';
  if (!['development', 'evaluation', 'all'].includes(split)) throw new RangeError('split must be development, evaluation or all.');
  if (input.taskId && split !== 'all' && !TASKS.some(t => t.id === input.taskId && (t.split ?? 'development') === split)) throw new RangeError('taskId does not belong to the selected split.');
  if (!registry.some(t => (!input.taskId || t.id === input.taskId) && (!input.family || t.family === input.family) && (split === 'all' || (t.split ?? 'development') === split))) throw new RangeError(`No ${suite} tasks belong to the selected split.`);
  const stateMode = input.stateMode ?? 'temporal';
  if (!['updates', 'temporal'].includes(stateMode)) throw new RangeError('stateMode must be updates or temporal.');
  if (suite !== 'legacy' && stateMode !== 'temporal') throw new RangeError('stateMode updates is a legacy control.');
  if (suite !== 'legacy' && input.delay != null && input.delay !== 7) throw new RangeError('delay is a legacy planning control.');
  const variant = input.variant ?? 'base';
  if (!['base', 'temporal_shift'].includes(variant)) throw new RangeError('variant must be base or temporal_shift.');
  if (suite === 'legacy' && variant !== 'base') throw new RangeError('temporal_shift is only available in the dynamics and temporal suites.');
  const ruleAccess = input.ruleAccess ?? 'infer';
  if (!['infer', 'given'].includes(ruleAccess)) throw new RangeError('ruleAccess must be infer or given.');
  if (suite !== 'dynamics' && ruleAccess !== 'infer') throw new RangeError('ruleAccess is a dynamics-learning control.');
  const strategies = input.strategies ?? (suite === 'legacy' ? STRATEGIES.map(s => s.id) : ['forward_only']);
  if (!Array.isArray(strategies) || !strategies.length || strategies.some(s => !STRATEGIES.some(item => item.id === s)) || new Set(strategies).size !== strategies.length) throw new RangeError('Choose distinct benchmark strategies.');
  if (input.model != null && (typeof input.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(input.model))) throw new RangeError('Invalid model identifier.');
  const options = {
    suite, variant, ruleAccess, taskId: input.taskId ?? null, family: input.family ?? null, policyKind, model: input.model ?? null, split, stateMode,
    seed: integer(input.seed, 'seed', 42, 0, 2147483647), seedCount: integer(input.seedCount, 'seedCount', 1, 1, policyKind === 'reference' || policyKind === 'custom' ? 50 : 3),
    attempts: integer(input.attempts, 'attempts', suite === 'legacy' ? 2 : 1, 1, 5), delay: integer(input.delay, 'delay', 7, 0, 7),
    analysisBudget: integer(input.analysisBudget, 'analysisBudget', suite === 'dynamics' ? 0 : 24, 0, 100), interference: integer(input.interference, 'interference', 0, 0, 3), strategies: [...strategies],
  };
  if (suite === 'dynamics' && (options.attempts !== 1 || options.strategies.length !== 1 || options.strategies[0] !== 'forward_only')) throw new RangeError('Dynamics forecasts allow one unassisted attempt with forward_only. Same-instance recovery after seeing outcomes is not unseen-future prediction.');
  if (options.seed + options.seedCount - 1 > 2147483647) throw new RangeError('The benchmark seed range exceeds the supported maximum.');
  return options;
}

function choiceFor(definition, response) {
  if (!response || typeof response.reasoning !== 'string' || !definition.actions.some(a => a.id === response.actionId)) throw new ModelError('The policy selected an invalid action.', 'MODEL_STRUCTURE');
  return definition.actions.find(a => a.id === response.actionId);
}
function outcomeFor(task, state) {
  const checks = task.score(state);
  const passed = checks.filter(c => c.passed).length;
  return { success: passed === checks.length, score: passed / checks.length, passed, total: checks.length,
    checks: checks.map(({ decisionT, ...check }) => clone(check)),
    failures: checks.filter(c => !c.passed).map(({ decisionT, passed, ...check }) => clone(check)) };
}
const errorFor = error => ({ code: error instanceof ModelError ? error.code : 'POLICY_ERROR', message: 'The policy could not complete this operation. No fallback was used.' });
export const usageSnapshot = policy => policy?.usage ? clone(policy.usage()) : null;
export function usageDelta(before, after) {
  if (!before || !after) return null;
  return Object.fromEntries(['calls', 'inputTokens', 'outputTokens', 'totalTokens', 'unreportedUsageCalls', 'reportedCostUSD', 'unreportedCostResponses'].map(key => [key, Number.isFinite(after[key]) && Number.isFinite(before[key]) ? after[key] - before[key] : null]));
}

export async function attempt(task, policy, index, { cards = [], delivery = 'none', previousAttempts = [], signal } = {}) {
  const state = { spent: 0, choices: {} };
  const steps = [], deliveries = [];
  const before = usageSnapshot(policy);
  let automaticActions = 0, policyDecisions = 0;
  try {
    for (const definition of task.definitions) {
      // Yield even for offline/forced operations so HTTP disconnects can cancel.
      await yieldToIO();
      if (signal?.aborted) throw new ModelError('The experiment was cancelled.', 'CANCELLED');
      const hints = delivery === 'matching_checkpoint' ? cards.filter(c => c.checkpointId === definition.checkpointId) : [];
      if (index > 1 && delivery === 'attempt_start' && definition.t === 1 && cards.length) deliveries.push({ t: 1, cards: clone(cards) });
      if (hints.length) deliveries.push({ t: definition.t, cards: clone(hints) });
      const context = { ...clone(task.public), ...(definition.phase ? { phase: definition.phase } : {}), attempt: index, t: definition.t, checkpointId: definition.checkpointId,
        observation: definition.observation, actions: clone(definition.actions), state: { spent: state.spent, effortBudget: task.public.effortBudget },
        history: clone(steps), hints: clone(hints), reflectionMemory: delivery === 'attempt_start' && cards.length ? { recommendations: clone(cards) } : null,
        previousAttempts: clone(previousAttempts) };
      const automatic = definition.actions.length === 1;
      let response;
      if (automatic) {
        automaticActions++;
        response = { actionId: definition.actions[0].id, reasoning: 'Automatically execute the sole legal action; no policy or model call.' };
      } else {
        policyDecisions++;
        response = await policy.decide(context);
      }
      const chosen = choiceFor(definition, response);
      const observed = task.transition(definition, chosen, state);
      steps.push({ ...clone(definition), action: clone(chosen), execution: automatic ? 'automatic' : 'policy', reasoning: response.reasoning, result: observed, spent: state.spent, injectedHints: clone(hints) });
    }
    const outcome = outcomeFor(task, state);
    return { index, instanceId: task.instanceId, status: 'completed', success: outcome.success, score: outcome.score, outcome, steps, deliveries, effort: state.spent, automaticActions, policyDecisions, modelUsage: usageDelta(before, policy.usage?.()) };
  } catch (error) {
    return { index, instanceId: task.instanceId, status: 'error', success: false, score: null, outcome: null, error: errorFor(error), steps, deliveries, effort: state.spent, automaticActions, policyDecisions, modelUsage: usageDelta(before, policy.usage?.()) };
  }
}

/** Same task closure, one changed decision, all other recorded actions fixed. */
export function replayTask(task, source, intervention) {
  if (source.instanceId !== task.instanceId) throw new RangeError('Replay must use the same task instance and seed.');
  if (source.status !== 'completed' || source.steps.length !== task.definitions.length) throw new RangeError('Replay requires a completed trajectory.');
  const target = task.definitions.find(d => d.checkpointId === intervention.checkpointId);
  if (!target || !target.actions.some(a => a.id === intervention.actionId)) throw new RangeError('Invalid replay intervention.');
  const state = { spent: 0, choices: {} };
  for (let i = 0; i < task.definitions.length; i++) {
    const definition = task.definitions[i], recorded = source.steps[i];
    if (recorded.t !== definition.t || recorded.checkpointId !== definition.checkpointId || !definition.actions.some(a => a.id === recorded.action?.id)) throw new RangeError('Replay trajectory is incomplete, reordered or invalid.');
    const chosen = definition.actions.find(a => a.id === (definition === target ? intervention.actionId : recorded.action.id));
    task.transition(definition, chosen, state);
  }
  return { outcome: outcomeFor(task, state), effort: state.spent, actions: task.definitions.length,
    fixedActions: source.steps.map(s => ({ checkpointId: s.checkpointId, actionId: s.checkpointId === target.checkpointId ? intervention.actionId : s.action.id })) };
}

async function analyze(task, policy, source, strategy, budget) {
  const before = usageSnapshot(policy);
  const report = { sourceAttempt: source.index, traversal: strategy.analysis, budget, replays: 0, replayActions: 0, replayEffort: 0, candidateTests: [], cards: [] };
  try {
    const method = strategy.analysis === 'backward' ? policy.invert : policy.reflect;
    if (typeof method !== 'function') throw new ModelError('The policy has no analyst implementation.', 'MODEL_CONTEXT');
    // Actor-visible completed records only. No task definitions or scoring closure.
    const proposals = await method.call(policy, { ...clone(task.public), trajectory: clone(source.steps), outcome: clone(source.outcome), budget: { maxReplays: budget } });
    if (!proposals || typeof proposals.summary !== 'string' || !Array.isArray(proposals.recommendations) || proposals.recommendations.length > 8) throw new ModelError('Invalid analysis recommendations.', 'MODEL_STRUCTURE');
    report.summary = proposals.summary;
    const seen = new Set();
    for (const proposal of proposals.recommendations) {
      if (!Number.isInteger(proposal?.targetT) || typeof proposal.actionId !== 'string' || typeof proposal.reasoning !== 'string') throw new ModelError('Invalid analysis recommendation.', 'MODEL_STRUCTURE');
      const original = source.steps.find(s => s.t === proposal.targetT);
      const test = { proposal: clone(proposal), accepted: false, reason: 'invalid_or_unchanged_action' };
      report.candidateTests.push(test);
      if (!original || original.action.id === proposal.actionId || !original.actions.some(a => a.id === proposal.actionId)) continue;
      const key = `${original.checkpointId}:${proposal.actionId}`;
      if (seen.has(key)) { test.reason = 'duplicate'; continue; }
      seen.add(key);
      if (report.replays >= budget) { test.reason = 'replay_budget_exhausted'; continue; }
      const replay = replayTask(task, source, { checkpointId: original.checkpointId, actionId: proposal.actionId });
      report.replays++; report.replayActions += replay.actions; report.replayEffort += replay.effort;
      const removed = source.outcome.failures.filter(f => replay.outcome.checks.some(c => c.id === f.id && c.passed)).map(f => f.id);
      // Budget violations and regressions block delivery even if a local defect vanishes.
      const introduced = replay.outcome.failures.filter(f => source.outcome.checks.some(c => c.id === f.id && c.passed)).map(f => f.id);
      test.replay = replay; test.removedFailureIds = removed; test.introducedFailureIds = introduced;
      test.accepted = removed.length > 0 && introduced.length === 0 && !replay.outcome.failures.some(f => f.id === 'effort_budget');
      test.reason = test.accepted ? 'locally_verified' : 'no_improvement_or_regression';
      if (test.accepted) report.cards.push({ checkpointId: original.checkpointId, targetT: original.t, actionId: proposal.actionId, reasoning: proposal.reasoning,
        sourceAttempt: source.index, removedFailureIds: removed, verification: 'fixed_seed_single_decision_replay' });
    }
  } catch (error) { report.error = errorFor(error); }
  report.modelUsage = usageDelta(before, policy.usage?.());
  return report;
}

/** Deliberately weak offline mechanism fixture; analyst enumerates public alternatives. */
export function createReferencePolicy() {
  const dynamics = createDynamicsReferencePolicy();
  const critic = context => {
    const targets = new Set(context.outcome.failures.flatMap(f => f.candidateCheckpoints));
    const recommendations = context.trajectory.filter(s => targets.has(s.checkpointId)).flatMap(s => s.actions.filter(a => a.id !== s.action.id).map(a => ({ targetT: s.t, actionId: a.id, reasoning: 'Try an available alternative at an observed failed gate candidate; evaluator replay must verify it.' })));
    return { summary: 'Enumerate observable candidate alternatives; no answer key is consulted.', recommendations: recommendations.slice(0, 8) };
  };
  return {
    async decide(context) {
      if (context.taskType === 'dynamics_learning') return dynamics.decide(context);
      const note = [...context.hints, ...(context.reflectionMemory?.recommendations ?? [])].find(c => c.checkpointId === context.checkpointId);
      return { actionId: note?.actionId ?? [...context.actions].sort((a, b) => a.cost - b.cost)[0].id, reasoning: note ? 'Apply a verified note from a completed attempt.' : 'Offline fixture: select the first least-effort action.' };
    },
    reflect: critic, invert: critic,
  };
}

function runMetrics(first, attempts, analyses) {
  const last = attempts.at(-1);
  return { firstAttemptSuccess: first.success, firstAttemptScore: first.score, finalSuccess: last.success, finalScore: last.score,
    recoveryEligible: first.status === 'completed' && !first.success, recoveredAfterFailure: first.status === 'completed' && !first.success && last.success,
    attemptsToSuccess: attempts.find(a => a.success)?.index ?? null, error: last.status === 'error' || analyses.some(a => a.error),
    forwardActions: attempts.reduce((n, a) => n + a.steps.length, 0), forwardEffort: attempts.reduce((n, a) => n + a.effort, 0),
    automaticActions: attempts.reduce((n, a) => n + a.automaticActions, 0), policyDecisions: attempts.reduce((n, a) => n + a.policyDecisions, 0),
    replays: analyses.reduce((n, a) => n + a.replays, 0), replayActions: analyses.reduce((n, a) => n + a.replayActions, 0), replayEffort: analyses.reduce((n, a) => n + a.replayEffort, 0),
    proposals: analyses.reduce((n, a) => n + a.candidateTests.length, 0), verifiedProposals: analyses.reduce((n, a) => n + a.candidateTests.filter(t => t.accepted).length, 0),
    deliveredCards: attempts.reduce((n, a) => n + a.deliveries.reduce((m, d) => m + d.cards.length, 0), 0) };
}

function aggregate(cases) {
  const rows = new Map();
  for (const item of cases) for (const run of item.runs) for (const family of [item.family, 'all']) {
    const key = `${family}:${run.strategy}`;
    if (!rows.has(key)) rows.set(key, { family, strategy: run.strategy, cases: 0, firstAttemptSuccesses: 0, finalSuccesses: 0, recoveryEligible: 0, recoveries: 0, errors: 0, forwardActions: 0, forwardEffort: 0, replayActions: 0, replayEffort: 0, scoredCases: 0, scoreSum: 0, firstScoredCases: 0, firstScoreSum: 0 });
    const row = rows.get(key), m = run.metrics;
    row.cases++; row.firstAttemptSuccesses += Number(m.firstAttemptSuccess); row.finalSuccesses += Number(m.finalSuccess);
    row.recoveryEligible += Number(m.recoveryEligible); row.recoveries += Number(m.recoveredAfterFailure); row.errors += Number(m.error);
    for (const field of ['forwardActions', 'forwardEffort', 'replayActions', 'replayEffort']) row[field] += m[field];
    if (m.finalScore !== null) { row.scoredCases++; row.scoreSum += m.finalScore; }
    if (m.firstAttemptScore !== null) { row.firstScoredCases++; row.firstScoreSum += m.firstAttemptScore; }
  }
  return [...rows.values()].map(({ scoreSum, firstScoreSum, ...r }) => ({ ...r, firstAttemptSuccessRate: r.firstAttemptSuccesses / r.cases, finalSuccessRate: r.finalSuccesses / r.cases,
    meanFirstAttemptScore: r.firstScoredCases ? firstScoreSum / r.firstScoredCases : null,
    recoveryRate: r.recoveryEligible ? r.recoveries / r.recoveryEligible : null, meanFinalScore: r.scoredCases ? scoreSum / r.scoredCases : null }));
}

export async function sourceFingerprint() {
  const files = ['benchmark/index.mjs', 'benchmark/tasks.mjs', 'benchmark/temporal-tasks.mjs', 'benchmark/dynamics-tasks.mjs', 'benchmark/dynamics-policy.mjs', 'model.mjs', 'model-client.mjs', 'server.mjs', 'cli.mjs', 'package.json'];
  const contents = await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
  return hash(contents.map((content, i) => [files[i], content.replace(/\r\n/g, '\n')]));
}

export async function runBenchmark(input = {}, { policy, signal } = {}) {
  let options = validateBenchmarkOptions(input);
  if (policy && input.policyKind == null) options = validateBenchmarkOptions({ ...input, policyKind: ['openai', 'compatible'].includes(policy.kind) ? policy.kind : 'custom' });
  if (policy && options.policyKind === 'reference') throw new RangeError('Injected policies must be labeled custom or a model provider, not reference.');
  if (!policy && options.policyKind !== 'reference') throw new RangeError('A non-reference benchmark requires an explicit policy.');
  policy ??= createReferencePolicy();
  const usageBefore = usageSnapshot(policy);
  const selected = (options.suite === 'dynamics' ? DYNAMICS_TASKS : options.suite === 'temporal' ? TEMPORAL_TASKS : LEGACY_TASKS).filter(t => (!options.taskId || t.id === options.taskId) && (!options.family || t.family === options.family) && (options.split === 'all' || (t.split ?? 'development') === options.split));
  const cases = [];
  let physicalForwardActions = 0, physicalForwardEffort = 0, physicalAutomaticActions = 0, physicalPolicyDecisions = 0;
  for (const metadata of selected) for (let offset = 0; offset < options.seedCount; offset++) {
    if (signal?.aborted) throw new ModelError('The benchmark was cancelled.', 'CANCELLED');
    const seed = options.seed + offset;
    const task = createTask({ taskId: metadata.id, seed, delay: options.delay, stateMode: options.stateMode, interference: options.interference, variant: options.variant, ruleAccess: options.ruleAccess });
    const first = await attempt(task, policy, 1, { signal });
    physicalForwardActions += first.steps.length; physicalForwardEffort += first.effort;
    physicalAutomaticActions += first.automaticActions; physicalPolicyDecisions += first.policyDecisions;
    const runs = [];
    for (const id of options.strategies) {
      const strategy = STRATEGIES.find(s => s.id === id);
      const attempts = [clone(first)], analyses = [];
      let cards = [];
      while (attempts.length < options.attempts && !attempts.at(-1).success && attempts.at(-1).status === 'completed') {
        if (signal?.aborted) throw new ModelError('The benchmark was cancelled.', 'CANCELLED');
        if (strategy.analysis) {
          const analysis = await analyze(task, policy, attempts.at(-1), strategy, options.analysisBudget);
          analyses.push(analysis);
          if (analysis.error) break;
          const merged = new Map(cards.map(c => [c.checkpointId, c]));
          for (const card of analysis.cards) merged.set(card.checkpointId, card);
          cards = [...merged.values()];
        }
        const next = await attempt(task, policy, attempts.length + 1, { cards, delivery: strategy.delivery,
          previousAttempts: strategy.memory === 'all_completed_attempts' ? attempts.map(a => ({ index: a.index, steps: a.steps, outcome: a.outcome })) : [], signal });
        physicalForwardActions += next.steps.length; physicalForwardEffort += next.effort;
        physicalAutomaticActions += next.automaticActions; physicalPolicyDecisions += next.policyDecisions;
        attempts.push(next);
      }
      runs.push({ strategy: id, status: analyses.some(a => a.error) || attempts.at(-1).status === 'error' ? 'error' : 'completed', attempts, analyses, metrics: runMetrics(first, attempts, analyses) });
    }
    const truth = first.status === 'completed' ? task.score({ spent: first.effort, choices: Object.fromEntries(first.steps.map(s => [s.checkpointId, s.action.id])) }) : [];
    cases.push({ taskId: metadata.id, family: metadata.family, suite: options.suite, variant: options.variant, split: metadata.split ?? 'development', seed, delay: metadata.family === 'delayed_consequences' ? options.delay : null,
      stateMode: metadata.family === 'temporal_state_tracking' ? options.stateMode : null, interference: options.interference,
      ...(options.suite === 'dynamics' ? { ruleAccess: options.ruleAccess, brief: clone(task.public) } : {}),
      firstAttemptHash: hash(first), evaluation: { ...(task.learningAudit ? { learningAudit: clone(task.learningAudit()) } : {}), observedFailureDelays: truth.filter(c => !c.passed && Number.isInteger(c.decisionT)).map(c => ({ checkId: c.id, steps: c.detectedAt - c.decisionT })) }, runs });
  }
  const allRuns = cases.flatMap(c => c.runs);
  const sourceHash = await sourceFingerprint();
  const cumulativeUsage = usageSnapshot(policy);
  const operationUsage = cumulativeUsage ? { ...cumulativeUsage, ...usageDelta(usageBefore, cumulativeUsage) } : null;
  const report = {
    schemaVersion: 4, benchmarkVersion: BENCHMARK_VERSION, kind: 'temporal_benchmark', status: allRuns.some(r => r.status === 'error') ? 'completed_with_errors' : 'completed',
    options, provenance: { sourceHash, runtime: process.version, platform: process.platform, model: operationUsage ?? { provider: options.policyKind, model: options.model, usage: 'unreported' } },
    protocol: { focus: options.suite === 'dynamics' ? 'dynamics_learning_and_prediction' : options.suite === 'temporal' ? 'online_temporal_state_reconstruction' : 'legacy_mixed_tasks',
      predictionOnly: options.suite === 'dynamics', sameInstanceRecovery: options.suite !== 'dynamics',
      primaryMeasure: options.suite === 'dynamics' ? 'unassisted unseen-future prediction accuracy; calibration observations are not scored' : 'unassisted first-attempt task success and query accuracy',
      recoveryMeasure: options.suite === 'dynamics' ? 'not evaluated; no retries of a resolved future' : 'secondary; subsequent attempts with strategy-specific assistance', sharedFirstAttempt: true, independentTrajectoryCopies: true, checkpointHintsOnLaterAttemptsOnly: true, analysisBudgetPerRound: options.analysisBudget,
      automaticSingletonActions: true, executionPolicy: 'Every multi-action decision uses the configured policy. Forced actions execute automatically, remain in history, and consume their normal environment effort.',
      strategies: options.strategies.map(id => STRATEGIES.find(s => s.id === id)), scoreRange: [0, 1], recoveryDenominator: 'completed unsuccessful first attempts; null rate when none',
      costAccounting: 'Per-strategy forward costs include the shared source. Physical totals and model usage count it once. Replay has no model calls.',
      contextPolicy: 'Complete current history; trace_memory retains all completed attempts; no truncation. Same model and per-call output cap for actors and both analysts.' },
    limitations: [...(options.suite === 'dynamics' ? ['One public deterministic dynamics family with a finite candidate mechanism space; success is not broad system-identification ability or research novelty.', 'The dynamics reference is a public-evidence candidate-enumeration learner, not a language model. It receives no evaluator answer key.', 'Known future inputs specify a fixed test schedule; predictions concern its hidden outcomes, not unknown external events.', 'The supplied-rule control tests applying a known mechanism; infer mode requires identifying dynamics from calibration runs.', 'No model experiment or superiority claim follows from offline reference results.'] : []), 'Public development and structural evaluation splits; the evaluation generators are visible, not a secret held-out set or evidence of generalization.', 'Reference policies are deterministic fixtures, not evidence of model ability.', 'First-attempt task success and assisted recovery measure different capabilities.', 'Trace memory receives raw evidence without replay-filtered notes; forward-only uses less analysis compute.', 'Reflection versus pincer mixes traversal order and delivery timing; it does not identify either effect separately.', 'No context-window equalization or repeated stochastic trials. Seeds control tasks, not model sampling.', 'Replay validates local improvements in this simulator; it does not prove unique or real-world causation.'],
    cases, summary: aggregate(cases), costs: { physicalForwardActions, physicalForwardEffort, physicalAutomaticActions, physicalPolicyDecisions, replayActions: allRuns.reduce((n, r) => n + r.metrics.replayActions, 0), replayEffort: allRuns.reduce((n, r) => n + r.metrics.replayEffort, 0), modelUsage: operationUsage },
  };
  return { ...report, reportHash: hash(report) };
}
