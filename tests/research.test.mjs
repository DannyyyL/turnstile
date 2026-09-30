import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelPolicy } from '../model.mjs';
import { runComparison, runExperiment, replayTrajectory } from '../engine/index.js';

const options = { scenarioId: 'webhook_release', seed: 42, attempts: 2, analysisBudget: 24 };

test('model critics receive the same complete evidence and output budget', async () => {
  const requests = [];
  const policy = createModelPolicy({
    apiKey: 'offline-test-key',
    model: 'test-model',
    maxOutputTokens: 900,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          status: 'completed',
          usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
          output: [{ content: [{ type: 'output_text', text: JSON.stringify({
            summary: 'The prior observation supports a candidate repair.', recommendations: [],
          }) }] }],
        }),
      };
    },
  });
  const context = {
    objective: 'Release a compatible service.',
    trajectory: [
      { t: 1, checkpointId: 'contract', action: { id: 'new_only' }, observation: 'Contract selected.' },
      { t: 8, checkpointId: 'build', observation: 'The build passed.' },
      { t: 15, checkpointId: 'client_check', observation: 'The active old client could not decode the payload.' },
    ],
    outcome: { success: false, reason: 'Compatibility gate failed.' },
  };
  const original = structuredClone(context);

  await policy.reflect(context);
  await policy.invert(context);

  assert.deepEqual(context, original, 'analysis must not mutate the source trace');
  assert.equal(requests.length, 2);
  const reflection = JSON.parse(requests[0].input[0].content);
  const inversion = JSON.parse(requests[1].input[0].content);
  assert.deepEqual(reflection.trajectory, original.trajectory);
  assert.deepEqual([...inversion.trajectory].reverse(), original.trajectory);
  const { trajectory: _forward, traversal: _forwardOrder, ...forwardEvidence } = reflection;
  const { trajectory: _backward, traversal: _backwardOrder, ...backwardEvidence } = inversion;
  assert.deepEqual(forwardEvidence, backwardEvidence);
  assert.equal(requests[0].max_output_tokens, 900);
  assert.equal(requests[1].max_output_tokens, 900);
  assert.deepEqual(requests[0].text.format.schema, requests[1].text.format.schema);
  assert.equal(policy.usage().totalTokens, 50);
});

test('paired modes start from identical independent source trajectories', () => {
  const { runs } = runComparison(options);
  const forward = runs.find(run => run.mode === 'forward_only');
  const reflection = runs.find(run => run.mode === 'reflection');
  const pincer = runs.find(run => run.mode === 'temporal_pincer');
  assert.deepEqual(forward.attempts[0], reflection.attempts[0]);
  assert.deepEqual(reflection.attempts[0], pincer.attempts[0]);
  assert.equal(reflection.analyses[0].availableBudget, pincer.analyses[0].availableBudget);
  assert.equal(forward.analyses.length, 0);
  const remembered = pincer.attempts[0].steps[0].action.id;
  reflection.attempts[0].steps[0].action.id = 'mutated-by-test';
  assert.equal(pincer.attempts[0].steps[0].action.id, remembered);
  assert.equal(forward.attempts[0].steps[0].action.id, remembered);
});

test('verified hints remove their claimed defect under a fixed single-decision replay', () => {
  const run = runExperiment({ ...options, mode: 'temporal_pincer' });
  const baseline = run.attempts[0];
  const snapshot = structuredClone(baseline);
  assert.ok(baseline.outcome.failures.length > 1);
  assert.ok(run.hints.length > 0);
  for (const hint of run.hints) {
    assert.ok(hint.detectedAt > hint.targetT, 'this fixture must exhibit a delayed consequence');
    assert.ok(baseline.outcome.failures.some(failure => failure.id === hint.counterfactual.baselineFailureId));
    const replay = replayTrajectory(options.scenarioId, options.seed, baseline.steps, {
      checkpointId: hint.checkpointId, actionId: hint.recommendedActionId,
    });
    assert.ok(!replay.outcome.failures.some(failure => failure.id === hint.counterfactual.baselineFailureId));
    assert.equal(replay.success, false, 'local repair does not mean every release defect is repaired');
    for (const original of baseline.steps) {
      const actual = replay.steps.find(step => step.checkpointId === original.checkpointId);
      assert.equal(actual.action.id, original.checkpointId === hint.checkpointId
        ? hint.recommendedActionId : original.action.id);
    }
    const unchanged = replayTrajectory(options.scenarioId, options.seed, baseline.steps, {
      checkpointId: hint.checkpointId, actionId: hint.targetActionId,
    });
    assert.ok(unchanged.outcome.failures.some(failure => failure.id === hint.counterfactual.baselineFailureId));
  }
  assert.deepEqual(baseline, snapshot, 'counterfactual evaluation must preserve the original evidence');
  assert.ok(run.analyses[0].candidateTests.some(candidate => !candidate.verified),
    'instrumented candidate provenance must not automatically be treated as verified causality');
});

test('future-derived cards are delivered only on a later attempt at the matching checkpoint', () => {
  const { runs } = runComparison(options);
  const pincer = runs.find(run => run.mode === 'temporal_pincer');
  const reflection = runs.find(run => run.mode === 'reflection');
  assert.ok(pincer.attempts[0].steps.every(step => step.injectedHints.length === 0));
  for (const attempt of pincer.attempts) {
    assert.equal(attempt.reflectionMemory, null);
    for (const step of attempt.steps) {
      for (const hint of step.injectedHints) {
        assert.equal(hint.checkpointId, step.checkpointId);
        assert.ok(hint.sourceAttempt < attempt.index);
        assert.equal(hint.counterfactual.verified, true);
      }
    }
  }
  assert.ok(pincer.attempts[1].hintDeliveries.length > 0);
  assert.ok(reflection.attempts.every(attempt => attempt.steps.every(step => step.injectedHints.length === 0)));
  assert.equal(reflection.attempts[0].reflectionMemory, null);
  assert.equal(reflection.attempts[1].reflectionMemory.deliveredAt, 'attempt_start');
});

test('backward evidence traversal discovers failures before following their earlier producer links', () => {
  const run = runExperiment({ ...options, mode: 'temporal_pincer' });
  const walk = run.analyses[0].reverseTrace;
  assert.deepEqual(walk.map(entry => entry.t), Array.from({ length: 16 }, (_, index) => 16 - index));
  const observed = new Set();
  let links = 0;
  for (const entry of walk) {
    assert.equal(entry.traceKind, 'instrumented_evidence_walk');
    for (const id of entry.detectedFailureIds) {
      const failure = run.attempts[0].outcome.failures.find(item => item.id === id);
      assert.equal(failure.detectedAt, entry.t);
      observed.add(id);
    }
    assert.ok(entry.activeFailureIds.every(id => observed.has(id)));
    for (const link of entry.candidateLinks) {
      assert.ok(observed.has(link.failureId), 'an earlier candidate link requires a discovered later observation');
      assert.equal(link.checkpointId, entry.checkpointId);
      const failure = run.attempts[0].outcome.failures.find(item => item.id === link.failureId);
      assert.ok(failure.detectedAt > entry.t);
      links += 1;
    }
  }
  assert.ok(links > 0);
});

test('zero replay budgets yield no oracle-derived repair and replay effort is counted', () => {
  for (const mode of ['reflection', 'temporal_pincer']) {
    const zero = runExperiment({ ...options, mode, analysisBudget: 0 });
    assert.equal(zero.analyses[0].replays, 0);
    assert.equal(zero.analyses[0].verifiedRepairs, 0);
    assert.equal(zero.metrics.replayActions, 0);
    assert.equal(zero.metrics.interventions, 0);
    const limited = runExperiment({ ...options, mode, analysisBudget: 1 });
    assert.ok(limited.analyses[0].replays <= 1);
    assert.equal(limited.metrics.replayActions, limited.analyses[0].replays * 16);
    assert.equal(limited.metrics.actions, limited.metrics.executionActions + limited.metrics.replayActions);
    assert.equal(limited.metrics.cost, limited.metrics.executionCost + limited.metrics.replayCost);
  }
});

test('empty custom analysis remains empty and analyst context exposes observed evidence only', () => {
  const contexts = [];
  let analysis;
  let reflection;
  const comparison = runComparison({ ...options, policy: {
    decide(context) {
      contexts.push(structuredClone(context));
      return { actionId: [...context.actions].sort((a, b) => a.cost - b.cost)[0].id };
    },
    invert(context) {
      analysis = structuredClone(context);
      return { summary: 'Insufficient evidence in this policy.', recommendations: [] };
    },
    reflect(context) {
      reflection = structuredClone(context);
      return { summary: 'Insufficient evidence in this policy.', recommendations: [] };
    },
  } });
  const run = comparison.runs.find(item => item.mode === 'temporal_pincer');
  assert.deepEqual(analysis, reflection, 'engine analyst hooks must receive identical evidence and replay limits');
  assert.deepEqual(analysis.trajectory, run.attempts[0].steps);
  assert.deepEqual(analysis.outcome, run.attempts[0].outcome);
  assert.equal(run.analyses[0].replays, 0);
  assert.equal(run.hints.length, 0, 'an empty model result must not fall back to oracle reference recommendations');
  const hiddenKeys = ['world', 'restart', 'sharedIds', 'burst', 'legacyClients', 'multipleTenants',
    'slowCohort', 'queuedRollback', 'overlap', 'concurrentWrites', 'largeTable', 'activeReads', 'edgeValues'];
  for (const context of [analysis, ...contexts]) {
    for (const key of hiddenKeys) assert.equal(Object.hasOwn(context, key), false);
    for (const key of hiddenKeys) assert.equal(Object.hasOwn(context.state ?? {}, key), false);
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value.candidateOrigins) && Object.hasOwn(value, 'detectedAt')) {
        assert.equal(value.attributionStatus, 'unverified_candidate_provenance');
        for (const key of ['originAt', 'checkpointId', 'actionId']) {
          assert.equal(Object.hasOwn(value, key), false,
            `a candidate observation must not disclose its evaluator-known causal ${key}`);
        }
        assert.ok(value.candidateOrigins.length > 0);
      }
      for (const item of Object.values(value)) inspect(item);
    };
    inspect(context);
    assert.ok(!JSON.stringify(context).includes('Release artifact records '),
      'the exact true producer must not leak through nested trajectory evidence');
  }
});

test('replay rejects malformed trajectories rather than silently invoking another policy', () => {
  const baseline = runExperiment({ ...options, mode: 'forward_only', attempts: 1 }).attempts[0];
  const duplicate = structuredClone(baseline.steps);
  duplicate[5] = structuredClone(duplicate[0]);
  assert.throws(() => replayTrajectory(options.scenarioId, options.seed, duplicate));
  const wrongAction = structuredClone(baseline.steps);
  wrongAction[2].action.id = 'not-a-real-action';
  assert.throws(() => replayTrajectory(options.scenarioId, options.seed, wrongAction));
});
