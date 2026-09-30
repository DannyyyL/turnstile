import { SCENARIOS, MODES, getScenario } from './scenarios.js';
export { SCENARIOS, MODES, getScenario };

const clone = (value) => JSON.parse(JSON.stringify(value));
const MODE_ALIASES = { forward: 'forward_only', pincer: 'temporal_pincer' };
const ENGINE_VERSION = '0.1.0';
const LIMITATIONS = [
  'The default agents are deterministic reference policies, not language models. They demonstrate the feedback mechanism; these scores do not establish model-level superiority.',
  'The forward reference policy greedily minimizes immediate action effort. Robust options are globally safe in these small tasks; a capable forward model can choose them on its first attempt.',
  'Candidate origins come from privileged simulator artifact provenance. Real coding-agent traces may not contain equally clean dependency links.',
  'Replay tests a single intervention with the same seed and a fixed later action sequence. Verification establishes local sufficiency in this environment, not unique causality or real-world causal certainty.',
  'There is no hard engineering-effort constraint, no stochastic tool failure after seed selection, and no embodied or live software execution.',
];

function randomFor(seed, scenarioId) {
  let value = 2166136261;
  for (const ch of `${seed}:${scenarioId}`) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return () => { value += 0x6d2b79f5; let x = value; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

// Hidden workload parameters stay inside the transition evaluator. Neither a
// reference agent, custom policy context, reflection nor inverted analysis sees them.
function createWorld(scenarioId, seed) {
  const rng = randomFor(seed, scenarioId);
  return { seed, scenarioId, restart: rng() < .9, sharedIds: rng() < .8, burst: rng() < .85, legacyClients: rng() < .8, multipleTenants: rng() < .9, slowCohort: rng() < .8, queuedRollback: rng() < .85, overlap: rng() < .9, concurrentWrites: rng() < .85, largeTable: rng() < .8, activeReads: rng() < .9, edgeValues: rng() < .8, rollback: rng() < .85 };
}

const rule = (id, title, at, origin, safe, condition, detail, observation, candidates = [origin]) => ({ id, title, at, origin, safe, condition, detail, observation, candidates });
const RULES = {
  webhook_release: [
    rule('acknowledged_event_loss', 'Acknowledged events disappear on restart', 12, 1, 'durable_inbox', 'restart', 'The endpoint acknowledged success before the event reached durable storage. Restarting the accepting worker loses acknowledged work.', 'Restart probe: an acknowledged event is missing from the durable inbox.', [1, 6]),
    rule('tenant_id_collision', 'Independent tenant events collide', 12, 2, 'tenant_event_id', 'sharedIds', 'Two tenants used the same local event ID. Global deduplication incorrectly discarded the second event.', 'Replay probe: tenant A event 0042 and tenant B event 0042 collapse into one delivery.', [2, 5]),
    rule('recovery_checkpoint_loss', 'Unfinished delivery cannot recover', 12, 6, 'durable_checkpoint', 'restart', 'A restarted delivery worker lost its in-memory progress marker and cannot recover an unfinished accepted delivery.', 'Recovery probe: a persisted pending event has no recoverable delivery checkpoint.', [1, 6]),
    rule('retry_amplification', 'Retries amplify a receiver burst', 13, 3, 'jittered_backoff', 'burst', 'Fixed one-second retries synchronize after receiver throttling and exceed the launch retry quota.', 'Burst probe: synchronized retries repeatedly exceed the receiver quota.', [3, 7]),
    rule('masked_tenant_failure', 'A failed tenant is hidden by fleet averages', 13, 7, 'tenant_metrics', 'slowCohort', 'A small tenant has a stalled queue, while aggregate success and latency remain healthy. The required cohort alert never fires.', 'Cohort probe: one tenant has a stale delivery queue without an alert.', [3, 7]),
    rule('legacy_client_break', 'Existing clients reject the new payload', 14, 4, 'versioned_schema', 'legacyClients', 'A currently supported client cannot deserialize the new-only field names.', 'Contract probe: a supported old client rejects the payload field names.'),
    rule('cross_tenant_access', 'Worker resolves another tenant’s object', 15, 5, 'tenant_scoped_access', 'multipleTenants', 'Shared service credentials authorize an object lookup outside the tenant named by the event.', 'Isolation probe: an event can resolve a valid object ID belonging to a different tenant.', [2, 5]),
    rule('rollback_unreadable_jobs', 'Rollback leaves queued jobs unreadable', 16, 8, 'compatible_rollback', 'queuedRollback', 'The previous binary cannot read the new inbox record format, leaving accepted work stranded during rollback.', 'Rollback probe: the previous worker binary cannot read a queued job written by this release.', [1, 8]),
  ],
  database_migration: [
    rule('old_binary_schema_break', 'Old application instances lose their schema', 12, 1, 'expand_schema', 'overlap', 'Replacing the identifier column breaks still-running application instances during the rolling deployment.', 'Overlap probe: the old application cannot find the identifier column.', [1, 2]),
    rule('unmigrated_record_reads', 'Unmigrated accounts disappear from reads', 12, 2, 'compatible_reads', 'overlap', 'The new-only read path rejects accounts that have not yet been backfilled.', 'Overlap probe: an account with an old-format identifier is missing from the new read path.', [1, 2]),
    rule('concurrent_write_divergence', 'Live writes diverge during migration', 12, 3, 'dual_writes', 'concurrentWrites', 'A write arriving after the backfill snapshot is not preserved in both representations.', 'Write probe: old and new application instances disagree on a concurrently updated account.', [3, 7]),
    rule('backfill_lock_timeout', 'Backfill holds locks past the request deadline', 13, 4, 'chunked_backfill', 'largeTable', 'The full-table transaction holds locks longer than the staging request deadline.', 'Load probe: a large backfill transaction causes account write timeouts.', [4, 5]),
    rule('index_read_block', 'Index creation blocks production reads', 13, 5, 'concurrent_index', 'activeReads', 'The blocking index build prevents active account reads from completing within their deadline.', 'Load probe: account reads wait behind the identifier index build.', [4, 5]),
    rule('partition_lag_hidden', 'A lagging partition escapes monitoring', 13, 8, 'partition_metrics', 'slowCohort', 'A small partition is stuck while global response latency appears healthy.', 'Partition probe: one partition has increasing migration lag without a matching alert.', [4, 8]),
    rule('unchecked_identity_corruption', 'An edge-case transformation violates identity', 14, 7, 'full_invariants', 'edgeValues', 'Sample validation misses a rare identifier transformation; required correspondence validation does not run.', 'Integrity probe: a rare transformed identifier violates row correspondence.', [3, 7]),
    rule('rollback_data_missing', 'The old application cannot roll back', 15, 6, 'retain_old_data', 'rollback', 'Dropping the old representation before the rollback window closes makes the previous binary unable to serve accounts.', 'Rollback probe: the previous application cannot read the retired identifier data.', [1, 6]),
  ],
};

function normalizeOptions(options = {}) {
  const scenarioId = options.scenarioId ?? 'webhook_release';
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new RangeError(`Unknown scenario: ${scenarioId}`);
  const mode = MODE_ALIASES[options.mode] ?? options.mode ?? 'temporal_pincer';
  if (!MODES.some((item) => item.id === mode)) throw new RangeError(`Unknown mode: ${mode}`);
  const seed = options.seed ?? 42;
  if (!(typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed)))) throw new TypeError('seed must be a finite number or string');
  const attempts = options.attempts ?? 2;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new RangeError('attempts must be an integer from 1 to 5');
  const analysisBudget = options.analysisBudget ?? 24;
  if (!Number.isInteger(analysisBudget) || analysisBudget < 0 || analysisBudget > 128) throw new RangeError('analysisBudget must be an integer from 0 to 128');
  return { ...options, scenarioId, scenario, seed, mode, attempts, analysisBudget, policyKind: options.policyKind ?? (options.policy ? 'custom' : 'reference') };
}

function initialState() {
  return { status: 'planning', decisions: {}, artifacts: [], checks: [], findings: [], spent: 0, completedSteps: 0 };
}

function observationBefore(definition, state, attemptIndex) {
  const prior = state.findings.length ? ` ${state.findings.length} observed gate failure(s) are recorded; the release configuration remains frozen.` : '';
  return `Attempt ${attemptIndex}, checkpoint ${definition.id}. ${definition.observation}${prior}`;
}

function transition(scenario, world, state, definition, chosenAction) {
  const next = clone(state);
  const t = definition.t;
  next.spent += chosenAction.cost;
  next.completedSteps = t;
  const effects = [];
  const observed = [];
  if (definition.kind === 'decision') {
    next.decisions[definition.id] = chosenAction.id;
    const artifact = { id: `artifact:${definition.id}`, label: chosenAction.label, checkpointId: definition.id, producerT: t, actionId: chosenAction.id };
    next.artifacts.push(artifact);
    effects.push({ id: `effect:${t}`, type: 'configuration', description: `${definition.phase}: ${chosenAction.label}.`, causedBy: [`decision:${definition.id}`], artifactId: artifact.id });
    observed.push(`Recorded ${chosenAction.label.toLowerCase()} in the release configuration.`);
  } else {
    if (definition.id === 'build') next.status = 'built';
    if (definition.id === 'deployment') next.status = 'staged';
    if (definition.id === 'pilot') observed.push('Healthy-path smoke tests pass. Rare restart, compatibility, load and rollback conditions have not yet been exercised.');
    effects.push({ id: `effect:${t}`, type: definition.kind === 'check' ? 'test' : 'operation', description: chosenAction.description, causedBy: next.artifacts.map((artifact) => artifact.id) });
    for (const requirement of RULES[scenario.id].filter((candidate) => candidate.at === t)) {
      const originDefinition = scenario.steps[requirement.origin - 1];
      const configured = next.decisions[originDefinition.id];
      const triggered = Boolean(world[requirement.condition]);
      const passed = !triggered || configured === requirement.safe;
      const check = { id: requirement.id, title: requirement.title, passed, observedAt: t, summary: passed ? (triggered ? `PASS: ${requirement.title.toLowerCase()} is prevented by the configured policy.` : 'PASS: this seeded workload does not activate the edge condition.') : requirement.observation };
      next.checks.push(check);
      observed.push(check.summary);
      if (!passed) {
        // Artifact provenance is instrumentation, not an oracle causal answer.
        // It supplies candidates; replay below must establish sufficiency.
        const candidateOrigins = requirement.candidates.map((originT) => ({ t: originT, checkpointId: scenario.steps[originT - 1].id, artifactId: `artifact:${scenario.steps[originT - 1].id}` }));
        const evidence = [requirement.observation, `Probe artifact provenance references ${candidateOrigins.map((origin) => origin.checkpointId).join(', ')}. These are candidate sources, not verified causes.`];
        // Do not export the simulator's ground-truth rule origin or diagnosis.
        // The public trace supplies observations and ambiguous provenance only.
        // Explicit decision attribution is created only after replay verification.
        const failure = { id: requirement.id, title: requirement.title, detail: requirement.observation, detectedAt: t, evidence, candidateOrigins, attributionStatus: 'unverified_candidate_provenance' };
        next.findings.push(failure);
        effects.push({ id: `finding:${requirement.id}`, type: 'failure', description: requirement.observation, causedBy: candidateOrigins.map((origin) => origin.artifactId), evidence: [...evidence] });
      }
    }
    if (t === scenario.duration) next.status = next.findings.length ? 'blocked' : 'approved';
  }
  return { state: next, effects, observed: observed.join(' ') || `Completed ${chosenAction.label.toLowerCase()}.` };
}

function finishAttempt(index, steps, state, deliveries, reflectionMemory) {
  const passed = state.checks.filter((check) => check.passed).length;
  const total = state.checks.length;
  const success = state.status === 'approved' && state.findings.length === 0;
  const score = total ? Math.round(passed / total * 100) : 0;
  const outcome = { success, summary: success ? `Release approved: ${passed}/${total} integration gates pass.` : `Release blocked: ${state.findings.length} delayed failure(s); ${passed}/${total} gates pass.`, failures: clone(state.findings), passed, total, finalState: clone(state) };
  return { index, success, score, cost: state.spent, steps, outcome, hintDeliveries: deliveries, reflectionMemory: clone(reflectionMemory ?? null) };
}

function referenceChoice(context) {
  const injected = context.hints.find((hint) => context.actions.some((action) => action.id === hint.recommendedActionId));
  if (injected) return { actionId: injected.recommendedActionId, reasoning: `Use the verified future-derived hint at this checkpoint: ${injected.message}`, usedHintId: injected.id };
  const remembered = context.reflectionMemory?.recommendations?.find((note) => note.checkpointId === context.checkpointId && context.actions.some((action) => action.id === note.actionId));
  if (remembered) return { actionId: remembered.actionId, reasoning: `Apply the end-of-run repair note received at attempt start: ${remembered.reasoning}` };
  const cheapest = [...context.actions].sort((a, b) => a.cost - b.cost)[0];
  return { actionId: cheapest.id, reasoning: context.actions.length === 1 ? `Complete the available workflow operation: ${cheapest.description}` : `Reference policy: choose the least immediate effort (${cheapest.cost} units) given the current observation. The late probe result is not available yet.` };
}

function decisionContext(scenario, definition, state, steps, index, seed, hints, reflectionMemory) {
  const matchingHints = hints.filter((hint) => hint.checkpointId === definition.id && hint.counterfactual.verified);
  return { scenario: clone(scenario), seed, attempt: index, t: definition.t, checkpointId: definition.id, phase: definition.phase, observation: observationBefore(definition, state, index), state: clone(state), actions: clone(definition.actions), history: clone(steps), reflectionMemory: clone(reflectionMemory ?? null), hints: clone(matchingHints) };
}

function recordStep(definition, context, response, stateBefore, changed) {
  const chosen = definition.actions.find((action) => action.id === response.actionId);
  return { t: definition.t, checkpointId: definition.id, phase: definition.phase, action: clone(chosen), availableActions: clone(definition.actions), observationBefore: context.observation, observation: changed.observed, reasoning: response.reasoning ?? 'Policy did not supply a rationale.', stateBefore: clone(stateBefore), stateAfter: clone(changed.state), effects: clone(changed.effects), injectedHints: clone(context.hints), terminal: definition.t === 16 };
}

function validateChoice(definition, response) {
  if (response?.then) throw new TypeError('Use runExperimentAsync for asynchronous policy hooks');
  const normalized = typeof response === 'string' ? { actionId: response } : response;
  if (!normalized || !definition.actions.some((action) => action.id === normalized.actionId)) throw new RangeError(`Policy selected an unavailable action at ${definition.id}: ${normalized?.actionId}`);
  return normalized;
}

function executeAttempt(config, index, hints = [], reflectionMemory = null, fixedActions = null, intervention = null) {
  const world = createWorld(config.scenarioId, config.seed);
  let state = initialState();
  const steps = [], deliveries = [];
  for (const definition of config.scenario.steps) {
    const context = decisionContext(config.scenario, definition, state, steps, index, config.seed, hints, reflectionMemory);
    const selected = intervention?.checkpointId === definition.id ? intervention.actionId : fixedActions?.[definition.id];
    const response = validateChoice(definition, selected ? { actionId: selected, reasoning: intervention?.checkpointId === definition.id ? 'Counterfactual: change this single decision; keep all later actions fixed.' : 'Replay the recorded action without consulting a policy.' } : config.policy?.decide ? config.policy.decide(clone(context)) : referenceChoice(context));
    const changed = transition(config.scenario, world, state, definition, definition.actions.find((action) => action.id === response.actionId));
    const step = recordStep(definition, context, response, state, changed);
    for (const hint of context.hints) deliveries.push({ hintId: hint.id, checkpointId: definition.id, t: definition.t, applied: response.actionId === hint.recommendedActionId, actualActionId: response.actionId, recommendedActionId: hint.recommendedActionId });
    steps.push(step);
    state = changed.state;
  }
  return finishAttempt(index, steps, state, deliveries, reflectionMemory);
}

async function executeAttemptAsync(config, index, hints = [], reflectionMemory = null) {
  const world = createWorld(config.scenarioId, config.seed);
  let state = initialState();
  const steps = [], deliveries = [];
  for (const definition of config.scenario.steps) {
    const context = decisionContext(config.scenario, definition, state, steps, index, config.seed, hints, reflectionMemory);
    const response = validateChoice(definition, config.policy?.decide ? await config.policy.decide(clone(context)) : referenceChoice(context));
    const changed = transition(config.scenario, world, state, definition, definition.actions.find((action) => action.id === response.actionId));
    const step = recordStep(definition, context, response, state, changed);
    for (const hint of context.hints) deliveries.push({ hintId: hint.id, checkpointId: definition.id, t: definition.t, applied: response.actionId === hint.recommendedActionId, actualActionId: response.actionId, recommendedActionId: hint.recommendedActionId });
    steps.push(step);
    state = changed.state;
  }
  return finishAttempt(index, steps, state, deliveries, reflectionMemory);
}

/** Re-run a recorded trajectory under the same workload with one intervention.
 * Every other action, including downstream choices, is held fixed. No policy is
 * invoked. This is the explicit environment oracle used to check local repair.
 */
export function replayTrajectory(scenarioId, seed, steps, intervention = null) {
  const config = normalizeOptions({ scenarioId, seed, attempts: 1, mode: 'forward_only' });
  if (!Array.isArray(steps) || steps.length !== config.scenario.duration) throw new TypeError('A complete recorded trajectory is required for replay');
  for (let index = 0; index < config.scenario.steps.length; index++) {
    const definition = config.scenario.steps[index];
    const recorded = steps[index];
    if (recorded?.t !== definition.t || recorded?.checkpointId !== definition.id || !definition.actions.some((action) => action.id === recorded?.action?.id)) {
      throw new TypeError(`Replay requires the canonical ordered checkpoint ${definition.id} at T=${definition.t} with a valid recorded action`);
    }
  }
  const fixedActions = Object.fromEntries(steps.map((step) => [step.checkpointId, step.action.id]));
  if (intervention && !config.scenario.steps.some((definition) => definition.id === intervention.checkpointId && definition.actions.some((action) => action.id === intervention.actionId))) throw new RangeError('Invalid counterfactual intervention');
  return executeAttempt(config, 1, [], null, fixedActions, intervention);
}

function candidateRepairs(config, previous, proposals) {
  const failures = config.mode === 'temporal_pincer' ? [...previous.outcome.failures].sort((a, b) => b.detectedAt - a.detectedAt) : [...previous.outcome.failures].sort((a, b) => a.detectedAt - b.detectedAt);
  const candidates = [];
  const walk = [];
  if (proposals) {
    for (const proposal of proposals.recommendations ?? []) {
      const definition = config.scenario.steps.find((step) => step.t === Number(proposal.targetT) || step.id === proposal.checkpointId);
      if (!definition || definition.kind !== 'decision') continue;
      const action = definition.actions.find((choice) => choice.id === proposal.actionId);
      const original = previous.steps.find((step) => step.checkpointId === definition.id);
      if (!action || action.id === original.action.id) continue;
      const related = failures.filter((failure) => failure.candidateOrigins.some((origin) => origin.checkpointId === definition.id));
      for (const failure of related) candidates.push({ failure, definition, action, original, rationale: proposal.reasoning });
    }
  } else if (config.mode !== 'temporal_pincer') {
    for (const failure of failures) {
      // Uses only recorded artifact candidates and public action alternatives,
      // not RULES.safe or hidden workload flags. The simulator can reject links.
      const origins = [...failure.candidateOrigins].sort((a, b) => a.t - b.t);
      for (const origin of origins) {
        const definition = config.scenario.steps.find((step) => step.id === origin.checkpointId);
        const original = previous.steps.find((step) => step.checkpointId === origin.checkpointId);
        for (const action of definition.actions.filter((choice) => choice.id !== original.action.id)) candidates.push({ failure, definition, action, original });
      }
    }
  }
  if (config.mode === 'temporal_pincer') {
    const frontier = [];
    for (const recorded of [...previous.steps].reverse()) {
      // This is the actual reverse evidence walk. An observed failure enters
      // the frontier only when its detection checkpoint is encountered. The
      // walk follows public producer links to earlier recorded decisions.
      const discovered = failures.filter((failure) => failure.detectedAt === recorded.t);
      frontier.push(...discovered);
      const links = frontier.flatMap((failure) => failure.candidateOrigins.filter((origin) => origin.checkpointId === recorded.checkpointId).map((origin) => ({ failure, origin })));
      const stepCandidates = [];
      for (const link of links) {
        const definition = config.scenario.steps.find((step) => step.id === link.origin.checkpointId);
        if (proposals) {
          stepCandidates.push(...candidates.filter((candidate) => candidate.failure.id === link.failure.id && candidate.definition.id === definition.id));
        } else {
          for (const action of definition.actions.filter((choice) => choice.id !== recorded.action.id)) {
            const candidate = { failure: link.failure, definition, action, original: recorded };
            candidates.push(candidate);
            stepCandidates.push(candidate);
          }
        }
      }
      walk.push({ t: recorded.t, checkpointId: recorded.checkpointId, phase: recorded.phase, detectedFailureIds: discovered.map((failure) => failure.id), activeFailureIds: frontier.map((failure) => failure.id), candidateLinks: stepCandidates.map((candidate) => ({ failureId: candidate.failure.id, checkpointId: candidate.definition.id, actionId: candidate.action.id })), sourceAttempt: previous.index, traceKind: 'instrumented_evidence_walk' });
    }
    // Model proposals are checked in the same checkpoint order as the walk.
    if (proposals) candidates.sort((a, b) => b.definition.t - a.definition.t);
  }
  return { candidates, walk };
}

function analysisContext(config, previous) {
  return { scenario: clone(config.scenario), trajectory: clone(previous.steps), outcome: clone(previous.outcome), budget: { maxReplays: config.analysisBudget, remainingReplays: config.analysisBudget }, instructions: 'Propose earlier alternative actions based only on observable evidence. Each proposal is replay-checked under the unchanged seed before it can be delivered. Artifact provenance supplies candidates, not causal certainty.' };
}

function analyze(config, previous, round, proposals = null) {
  const repairs = [], tested = [], reverseTrace = [];
  let replayCost = 0, replayActions = 0;
  const repairedFailures = new Set();
  const cache = new Map();
  const { candidates, walk } = candidateRepairs(config, previous, proposals);
  for (const candidate of candidates) {
    if (repairedFailures.has(candidate.failure.id)) continue;
    const cacheKey = `${candidate.definition.id}:${candidate.action.id}`;
    let replay = cache.get(cacheKey);
    if (!replay) {
      if (cache.size >= config.analysisBudget) break;
      replay = replayTrajectory(config.scenarioId, config.seed, previous.steps, { checkpointId: candidate.definition.id, actionId: candidate.action.id });
      cache.set(cacheKey, replay);
      replayCost += replay.cost;
      replayActions += replay.steps.length;
    }
    const verified = !replay.outcome.failures.some((failure) => failure.id === candidate.failure.id);
    const counterfactual = { verified, criterion: 'The specific observed failure disappears; other failures may remain.', unchangedSeed: config.seed, heldFixed: 'Every action except this checkpoint, including all downstream actions.', baselineActionId: candidate.original.action.id, interventionActionId: candidate.action.id, checkpointId: candidate.definition.id, baselineFailureId: candidate.failure.id, baselineFailurePresent: true, replayFailurePresent: !verified, replaySuccess: replay.success, replayScore: replay.score, replayRemainingFailures: replay.outcome.failures.map((failure) => failure.id), replayActions: replay.steps.length, replayCost: replay.cost };
    tested.push({ failureId: candidate.failure.id, targetT: candidate.definition.t, checkpointId: candidate.definition.id, actionId: candidate.action.id, verified, counterfactual });
    if (!verified) continue;
    repairedFailures.add(candidate.failure.id);
    const chain = [
      { t: candidate.definition.t, type: 'decision', title: candidate.original.action.label, detail: `The original attempt committed ${candidate.original.action.id} at checkpoint ${candidate.definition.id}.`, artifactId: `artifact:${candidate.definition.id}` },
      { t: 9, type: 'activation', title: 'Configuration frozen in the release artifact', detail: 'The chosen configuration is packaged and then activated in the staging cohort.' },
      { t: candidate.failure.detectedAt, type: 'observation', title: candidate.failure.title, detail: candidate.failure.detail },
    ];
    const evidence = [...candidate.failure.evidence, `Intervention replay under unchanged seed ${config.seed}: replace ${candidate.original.action.id} with ${candidate.action.id}; ${candidate.failure.id} disappears while all other actions stay fixed.`];
    repairs.push({ id: `hint:${round}:${candidate.failure.id}:${candidate.definition.id}`, targetT: candidate.definition.t, checkpointId: candidate.definition.id, targetActionId: candidate.original.action.id, recommendedActionId: candidate.action.id, recommendedActionLabel: candidate.action.label, originT: candidate.definition.t, detectedAt: candidate.failure.detectedAt, sourceAttempt: previous.index, title: candidate.failure.title, message: `At ${candidate.definition.phase.toLowerCase()}, choose “${candidate.action.label}”. The original “${candidate.original.action.label}” later contributed to “${candidate.failure.title}” at T=${candidate.failure.detectedAt}; a one-decision replay removes that failure.`, evidence, causalChain: chain, counterfactual, reasoning: candidate.rationale ?? 'Recorded artifact provenance produced a candidate link; fixed-trajectory replay establishes local sufficiency.' });
  }
  if (config.mode === 'temporal_pincer') {
    for (const entry of walk) {
      const findings = previous.outcome.failures.filter((failure) => entry.detectedFailureIds.includes(failure.id));
      const related = repairs.filter((repair) => repair.targetT === entry.t);
      const stepTests = tested.filter((candidate) => candidate.targetT === entry.t);
      reverseTrace.push({ ...entry, title: related.length ? `Locate ${related.length} verified earlier decision(s)` : findings.length ? `Start from ${findings.length} delayed failure(s)` : `Inspect ${entry.phase.toLowerCase()}`, detail: related.length ? related.map((repair) => `${repair.title}: ${repair.targetActionId} → ${repair.recommendedActionId}, verified by single-intervention replay.`).join(' ') : findings.length ? findings.map((failure) => failure.detail).join(' ') : entry.candidateLinks.length ? `Follow ${entry.candidateLinks.length} candidate artifact link(s) to this earlier decision; replay evaluates local sufficiency.` : 'Read the recorded state transition and carry observed failure evidence backward; no hidden workload parameters are available.', failureIds: entry.detectedFailureIds, hintIds: related.map((repair) => repair.id), candidateTests: clone(stepTests) });
    }
  }
  const reflectionMemory = { deliveredAt: 'attempt_start', sourceAttempt: previous.index, summary: proposals?.summary ?? `Completed-run critique found ${previous.outcome.failures.length} failed gates. ${repairs.length} repairs passed local intervention checks. Retain these notes for the next attempt.`, recommendations: repairs.map((repair) => ({ targetT: repair.targetT, checkpointId: repair.checkpointId, actionId: repair.recommendedActionId, reasoning: `${repair.title}: ${repair.reasoning}`, evidence: repair.evidence, counterfactual: repair.counterfactual })) };
  return { round, sourceAttempt: previous.index, mode: config.mode, analyzerKind: proposals ? 'custom_policy_with_replay_verification' : 'deterministic_artifact_provenance_reference', traceKind: config.mode === 'temporal_pincer' ? 'instrumented_evidence_walk' : 'forward_completed_trajectory_critique', availableBudget: config.analysisBudget, replays: cache.size, replayCost, replayActions, candidateTests: tested, verifiedRepairs: repairs.length, unresolvedFailureIds: previous.outcome.failures.filter((failure) => !repairedFailures.has(failure.id)).map((failure) => failure.id), hints: repairs, reverseTrace, reflectionMemory };
}

function buildRun(config, attempts, analyses) {
  const finalAttempt = attempts.at(-1);
  const executionCost = attempts.reduce((total, attempt) => total + attempt.cost, 0);
  const replayCost = analyses.reduce((total, analysis) => total + analysis.replayCost, 0);
  const executionActions = attempts.reduce((total, attempt) => total + attempt.steps.length, 0);
  const replayActions = analyses.reduce((total, analysis) => total + analysis.replayActions, 0);
  const deliveries = attempts.flatMap((attempt) => attempt.hintDeliveries);
  const recommendations = analyses.flatMap((analysis) => analysis.hints);
  const interventions = config.mode === 'temporal_pincer' ? deliveries.filter((delivery) => delivery.applied).length : attempts.reduce((total, attempt) => total + (attempt.reflectionMemory?.recommendations.filter((note) => attempt.steps.some((step) => step.checkpointId === note.checkpointId && step.action.id === note.actionId)).length ?? 0), 0);
  return { id: `${config.scenarioId}:${config.seed}:${config.mode}:${ENGINE_VERSION}`, version: ENGINE_VERSION, mode: config.mode, scenarioId: config.scenarioId, seed: config.seed, policyKind: config.policyKind, policyLabel: config.policyKind === 'reference' ? 'Deterministic reference policies' : 'Custom model policy', attempts, hints: config.mode === 'temporal_pincer' ? recommendations : [], reverseTrace: analyses.flatMap((analysis) => analysis.reverseTrace), reflections: config.mode === 'reflection' ? analyses.map((analysis) => analysis.reflectionMemory) : [], analyses, metrics: { success: finalAttempt.success, firstSuccess: attempts.find((attempt) => attempt.success)?.index ?? null, finalScore: finalAttempt.score, cost: executionCost + replayCost, executionCost, replayCost, actions: executionActions + replayActions, executionActions, replayActions, counterfactualReplays: analyses.reduce((total, analysis) => total + analysis.replays, 0), interventions, deliveredHints: deliveries.length, verifiedRepairs: recommendations.length, maxDecisionDelay: recommendations.length ? Math.max(...recommendations.map((repair) => repair.detectedAt - repair.targetT)) : 0 }, parameters: { requestedAttempts: config.attempts, actualAttempts: attempts.length, analysisBudgetPerRound: config.analysisBudget, costUnit: 'abstract engineering effort', feedbackTiming: config.mode === 'temporal_pincer' ? 'matching_checkpoint' : config.mode === 'reflection' ? 'attempt_start' : 'none' }, limitations: [...LIMITATIONS] };
}

function mergeMemory(previous, current) {
  if (!previous) return current;
  const notes = new Map(previous.recommendations.map((note) => [note.checkpointId, note]));
  for (const note of current.recommendations) notes.set(note.checkpointId, note);
  return { ...current, recommendations: [...notes.values()], summary: `${current.summary} Earlier verified repair notes are retained.` };
}

function mergeHints(previous, current) {
  const hints = new Map(previous.map((hint) => [hint.checkpointId, hint]));
  for (const hint of current) hints.set(hint.checkpointId, hint);
  return [...hints.values()];
}

export function runExperiment(options = {}) {
  const config = normalizeOptions(options);
  const attempts = [], analyses = [];
  let activeHints = [], reflectionMemory = null;
  const first = config._sharedFirstAttempt ? clone(config._sharedFirstAttempt) : executeAttempt(config, 1);
  attempts.push(first);
  for (let index = 2; index <= config.attempts && !attempts.at(-1).success; index++) {
    if (config.mode !== 'forward_only') {
      const method = config.mode === 'reflection' ? config.policy?.reflect : config.policy?.invert;
      const proposals = method ? method(analysisContext(config, attempts.at(-1))) : null;
      if (proposals?.then) throw new TypeError('Use runExperimentAsync for asynchronous policy hooks');
      const analysis = analyze(config, attempts.at(-1), analyses.length + 1, proposals);
      analyses.push(analysis);
      if (config.mode === 'temporal_pincer') activeHints = mergeHints(activeHints, analysis.hints);
      else reflectionMemory = mergeMemory(reflectionMemory, analysis.reflectionMemory);
    }
    attempts.push(executeAttempt(config, index, activeHints, reflectionMemory));
  }
  return buildRun(config, attempts, analyses);
}

export async function runExperimentAsync(options = {}) {
  const config = normalizeOptions(options);
  const attempts = [], analyses = [];
  let activeHints = [], reflectionMemory = null;
  attempts.push(config._sharedFirstAttempt ? clone(config._sharedFirstAttempt) : await executeAttemptAsync(config, 1));
  for (let index = 2; index <= config.attempts && !attempts.at(-1).success; index++) {
    if (config.mode !== 'forward_only') {
      const method = config.mode === 'reflection' ? config.policy?.reflect : config.policy?.invert;
      const proposals = method ? await method(analysisContext(config, attempts.at(-1))) : null;
      const analysis = analyze(config, attempts.at(-1), analyses.length + 1, proposals);
      analyses.push(analysis);
      if (config.mode === 'temporal_pincer') activeHints = mergeHints(activeHints, analysis.hints);
      else reflectionMemory = mergeMemory(reflectionMemory, analysis.reflectionMemory);
    }
    attempts.push(await executeAttemptAsync(config, index, activeHints, reflectionMemory));
  }
  return buildRun(config, attempts, analyses);
}

function comparisonResult(config, runs) {
  return { id: `comparison:${config.scenarioId}:${config.seed}:${ENGINE_VERSION}`, scenarioId: config.scenarioId, seed: config.seed, policyKind: config.policyKind, runs, summary: runs.map((run) => ({ mode: run.mode, label: MODES.find((mode) => mode.id === run.mode).label, success: run.metrics.success, firstSuccess: run.metrics.firstSuccess, finalScore: run.metrics.finalScore, cost: run.metrics.cost, executionCost: run.metrics.executionCost, replayCost: run.metrics.replayCost, actions: run.metrics.actions, interventions: run.metrics.interventions, counterfactualReplays: run.metrics.counterfactualReplays, attempts: run.attempts.length })), comparisonProtocol: { sharedFirstAttempt: true, sameSeed: true, sameObservableSourceTrajectory: true, analysisBudgetPerRound: config.analysisBudget, reflectionAndPincerReceiveSameEvidence: true, stopsAfterSuccess: true, warning: 'A tie between reflection and temporal pincer is a valid result. This reference fixture compares feedback delivery and causal localization, not general model competence.' }, limitations: [...LIMITATIONS] };
}

export function runComparison(options = {}) {
  const config = normalizeOptions(options);
  const sharedFirstAttempt = executeAttempt({ ...config, mode: 'forward_only' }, 1);
  const runs = MODES.map((mode) => runExperiment({ ...options, mode: mode.id, _sharedFirstAttempt: sharedFirstAttempt }));
  return comparisonResult(config, runs);
}

export async function runComparisonAsync(options = {}) {
  const config = normalizeOptions(options);
  const sharedFirstAttempt = await executeAttemptAsync({ ...config, mode: 'forward_only' }, 1);
  const runs = [];
  // Sequential model calls avoid interleaving a stateful custom policy's memory.
  for (const mode of MODES) runs.push(await runExperimentAsync({ ...options, mode: mode.id, _sharedFirstAttempt: sharedFirstAttempt }));
  return comparisonResult(config, runs);
}
