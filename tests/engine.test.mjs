import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, runExperiment, runComparison, runExperimentAsync, runComparisonAsync, replayTrajectory } from '../engine/index.js';

test('seeded reference experiments are reproducible and vary across workload seeds', () => {
  const a = runComparison({ seed: 42 });
  assert.deepEqual(runComparison({ seed: 42 }), a);
  const signatures = new Set(Array.from({ length: 16 }, (_, seed) => runExperiment({ seed, attempts: 1 }).attempts[0].outcome.failures.map((failure) => failure.id).join(',')));
  assert.ok(signatures.size > 1, 'seed changes actual workload checks, not just run labels');
});

test('both scenarios execute real state transitions and compute readiness from observed gates', () => {
  for (const scenario of SCENARIOS) {
    const run = runExperiment({ scenarioId: scenario.id, seed: 42, attempts: 2 });
    assert.equal(run.attempts[0].steps.length, 16);
    assert.equal(run.attempts[0].outcome.total, 8);
    assert.ok(run.attempts[0].outcome.failures.length > 0);
    assert.equal(run.attempts[0].steps[8].stateAfter.status, 'built');
    assert.equal(run.attempts[0].steps[9].stateAfter.status, 'staged');
    assert.equal(run.attempts[0].steps[0].stateBefore.artifacts.length, 0);
    assert.equal(run.attempts[0].steps[0].stateAfter.artifacts.length, 1);
    assert.equal(run.attempts[0].score, Math.round(run.attempts[0].outcome.passed / 8 * 100));
    assert.equal(run.metrics.success, true);
    assert.equal(run.attempts.at(-1).outcome.finalState.status, 'approved');
  }
});

test('forward policies see current observations and public state without hidden workload truths', () => {
  const contexts = [];
  const run = runExperiment({ attempts: 1, policy: { decide(context) { contexts.push(context); return context.actions[0].id; } } });
  assert.equal(contexts.length, 16);
  for (const context of contexts) {
    assert.equal(context.history.length, context.t - 1);
    assert.equal(context.reflectionMemory, null);
    assert.deepEqual(context.hints, []);
    assert.equal(context.world, undefined);
    assert.equal(context.hidden, undefined);
    assert.equal(context.state.completedSteps, context.t - 1);
    assert.ok(context.state.findings.every((finding) => finding.detectedAt < context.t));
  }
  assert.equal(contexts[11].state.findings.length, 0, 'T12 result is unavailable to the policy making T12 action');
  assert.ok(run.attempts[0].steps[11].stateAfter.findings.length > 0);
});

test('raw failures never publish the simulator answer key, including nested state snapshots', () => {
  const run = runExperiment({ attempts: 1 });
  const findings = [
    ...run.attempts[0].outcome.failures,
    ...run.attempts[0].steps.flatMap((step) => [...step.stateBefore.findings, ...step.stateAfter.findings]),
  ];
  assert.ok(findings.length > 0);
  for (const failure of findings) {
    assert.equal(failure.originAt, undefined);
    assert.equal(failure.actionId, undefined);
    assert.equal(failure.checkpointId, undefined);
    assert.equal(failure.attributionStatus, 'unverified_candidate_provenance');
    assert.ok(failure.evidence.every((evidence) => !evidence.includes('Release artifact records')));
  }
});

test('shared first attempts and state snapshots are independently owned', () => {
  const comparison = runComparison();
  assert.deepEqual(comparison.runs[0].attempts[0], comparison.runs[1].attempts[0]);
  const untouched = comparison.runs[1].attempts[0].steps[0].stateAfter.decisions.intake;
  comparison.runs[0].attempts[0].steps[0].stateAfter.decisions.intake = 'mutation';
  assert.equal(comparison.runs[1].attempts[0].steps[0].stateAfter.decisions.intake, untouched);
  assert.equal(comparison.runs[0].attempts[0].steps[1].stateBefore.decisions.intake, untouched);
});

test('single-intervention replay preserves the seed and every other recorded action', () => {
  const run = runExperiment();
  const baseline = run.attempts[0];
  const ordinaryReplay = replayTrajectory(run.scenarioId, run.seed, baseline.steps);
  assert.deepEqual(ordinaryReplay.outcome, baseline.outcome);
  for (const hint of run.hints) {
    const replay = replayTrajectory(run.scenarioId, run.seed, baseline.steps, { checkpointId: hint.checkpointId, actionId: hint.recommendedActionId });
    const differences = replay.steps.filter((step, index) => step.action.id !== baseline.steps[index].action.id);
    assert.equal(differences.length, 1);
    assert.equal(differences[0].checkpointId, hint.checkpointId);
    assert.ok(!replay.outcome.failures.some((failure) => failure.id === hint.counterfactual.baselineFailureId));
    assert.equal(hint.counterfactual.unchangedSeed, 42);
    assert.equal(hint.counterfactual.verified, true);
    assert.ok(hint.evidence.some((evidence) => evidence.includes('all other actions stay fixed')));
  }
});

test('replay rejects incomplete, duplicated, reordered or invalid-action records', () => {
  const run = runExperiment({ attempts: 1 });
  const trajectory = run.attempts[0].steps;
  assert.throws(() => replayTrajectory(run.scenarioId, run.seed, trajectory.slice(1)), /complete recorded trajectory/);
  const duplicated = structuredClone(trajectory);
  duplicated[5] = structuredClone(duplicated[0]);
  assert.throws(() => replayTrajectory(run.scenarioId, run.seed, duplicated), /canonical ordered checkpoint/);
  const reordered = structuredClone(trajectory);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => replayTrajectory(run.scenarioId, run.seed, reordered), /canonical ordered checkpoint/);
  const invalid = structuredClone(trajectory);
  invalid[0].action.id = 'invented_action';
  assert.throws(() => replayTrajectory(run.scenarioId, run.seed, invalid), /canonical ordered checkpoint/);
});

test('candidate provenance links that fail replay are rejected and never delivered as causal hints', () => {
  const run = runExperiment();
  const rejected = run.analyses[0].candidateTests.filter((candidate) => !candidate.verified);
  assert.ok(rejected.length > 0);
  for (const candidate of rejected) assert.ok(!run.hints.some((hint) => hint.counterfactual.baselineFailureId === candidate.failureId && hint.checkpointId === candidate.checkpointId));
});

test('temporal feedback is delivered only to its stable matching retry checkpoint', () => {
  const run = runExperiment();
  assert.ok(run.attempts[0].steps.every((step) => step.injectedHints.length === 0));
  for (const step of run.attempts[1].steps) for (const hint of step.injectedHints) {
    assert.equal(hint.checkpointId, step.checkpointId);
    assert.equal(hint.targetT, step.t);
    assert.equal(step.action.id, hint.recommendedActionId);
    assert.ok(hint.detectedAt > hint.targetT);
  }
  assert.equal(run.metrics.deliveredHints, run.hints.length);
  assert.deepEqual(run.reverseTrace.map((entry) => entry.t), Array.from({ length: 16 }, (_, index) => 16 - index));
  assert.ok(run.reverseTrace.every((entry) => entry.traceKind === 'instrumented_evidence_walk'));
  assert.ok(run.reverseTrace.find((entry) => entry.t === 12).activeFailureIds.length > 0);
  assert.ok(run.reverseTrace.find((entry) => entry.t === 1).candidateLinks.some((link) => link.checkpointId === 'intake'));
});

test('ordinary reflection sees the same source evidence and can tie the pincer', () => {
  const comparison = runComparison();
  const reflection = comparison.runs.find((run) => run.mode === 'reflection');
  const pincer = comparison.runs.find((run) => run.mode === 'temporal_pincer');
  assert.deepEqual(reflection.attempts[0], pincer.attempts[0]);
  assert.equal(reflection.metrics.success, true);
  assert.equal(pincer.metrics.success, true);
  assert.equal(reflection.metrics.finalScore, pincer.metrics.finalScore);
  assert.equal(reflection.analyses[0].availableBudget, pincer.analyses[0].availableBudget);
  assert.equal(reflection.attempts[1].reflectionMemory.deliveredAt, 'attempt_start');
  assert.ok(reflection.attempts[1].steps.every((step) => !step.injectedHints.length));
  assert.equal(pincer.attempts[1].reflectionMemory, null);
});

test('zero and small replay budgets are enforced and replay actions enter cost metrics', () => {
  for (const mode of ['reflection', 'temporal_pincer']) {
    const zero = runExperiment({ mode, analysisBudget: 0 });
    assert.equal(zero.metrics.counterfactualReplays, 0);
    assert.equal(zero.metrics.interventions, 0);
    assert.equal(zero.metrics.success, false);
    const limited = runExperiment({ mode, analysisBudget: 1, attempts: 3 });
    assert.ok(limited.analyses.every((analysis) => analysis.replays <= 1));
    assert.equal(limited.metrics.replayActions, limited.metrics.counterfactualReplays * 16);
    assert.equal(limited.metrics.actions, limited.metrics.executionActions + limited.metrics.replayActions);
    assert.equal(limited.metrics.cost, limited.metrics.executionCost + limited.metrics.replayCost);
  }
});

test('async model hooks get masked contexts and a comparison shares one actual model first attempt', async () => {
  let calls = 0;
  const policy = { async decide(context) { calls++; assert.equal(context.world, undefined); return { actionId: context.actions.at(-1).id, reasoning: 'Choose the robust public option.' }; } };
  const comparison = await runComparisonAsync({ policy, policyKind: 'test-model' });
  assert.equal(calls, 16, 'a successful common source attempt is executed only once');
  assert.ok(comparison.runs.every((run) => run.metrics.success && run.attempts.length === 1));
  assert.deepEqual(comparison.runs[0].attempts[0], comparison.runs[2].attempts[0]);
  assert.equal(comparison.policyKind, 'test-model');
});

test('custom analyst proposals require replay validation before affecting the next attempt', async () => {
  const analystContexts = [];
  const policy = {
    async decide(context) { return context.hints[0]?.recommendedActionId ?? context.actions[0].id; },
    async invert(context) { analystContexts.push(context); return { summary: 'Candidate source repair.', recommendations: [{ targetT: 1, actionId: 'durable_inbox', reasoning: 'Accepted work vanished on restart.' }, { targetT: 6, actionId: 'durable_checkpoint', reasoning: 'This might affect the intake failure.' }, { targetT: 9, actionId: 'imaginary_action', reasoning: 'Invalid recommendation.' }] }; },
  };
  const run = await runExperimentAsync({ policy, attempts: 2 });
  assert.equal(analystContexts.length, 1);
  assert.equal(analystContexts[0].trajectory.length, 16);
  assert.equal(analystContexts[0].world, undefined);
  assert.ok(run.hints.length > 0);
  assert.ok(run.hints.every((hint) => hint.counterfactual.verified));
  assert.ok(run.analyses[0].candidateTests.some((candidate) => !candidate.verified));
  assert.ok(run.analyses[0].unresolvedFailureIds.length > 0);
});

test('invalid configuration and unavailable actions fail clearly', () => {
  assert.throws(() => runExperiment({ scenarioId: 'maze' }), /Unknown scenario/);
  assert.throws(() => runExperiment({ attempts: 0 }), /attempts/);
  assert.throws(() => runExperiment({ analysisBudget: -1 }), /analysisBudget/);
  assert.throws(() => runExperiment({ policy: { decide: () => ({ actionId: 'imaginary' }) } }), /unavailable action/);
});
