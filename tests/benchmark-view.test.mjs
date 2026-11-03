import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark, createReferencePolicy } from '../benchmark/index.mjs';
import { ModelError } from '../model.mjs';
import { runValidation } from '../benchmark/validation.mjs';
import { scoreTable, costCards, stepDetail, gateChecks, analysisDetails, taskBriefDetails, validateSavedReport, validationSummary } from '../public/benchmark-view.js';

// Historical fixtures retain the replay/error cases already tested by the UI.
const oneTask = { suite: 'legacy', taskId: 'temporal_release', seed: 42, attempts: 2, strategies: ['forward_only', 'trace_memory', 'reflection', 'temporal_pincer'] };
const textOf = markup => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const runFor = (report, strategy) => report.cases[0].runs.find(run => run.strategy === strategy);

test('browser results distinguish zero recovery from no eligible failures using real scored reports', async () => {
  const failed = await runBenchmark({ ...oneTask, attempts: 1 });
  const failedTable = textOf(scoreTable(failed));
  assert.match(failedTable, /0% 0 \/ 1 eligible failures/);
  assert.doesNotMatch(failedTable, /No eligible failures/);

  const policy = { async decide(context) {
    let actionId = context.actions[0].id;
    if (context.checkpointId === 'inspection') actionId = 'inspect';
    else if (context.actions.length > 1) actionId = context.history[0].result.split('. ')[0].includes(context.checkpointId) ? 'guarded' : 'basic';
    return { actionId, reasoning: 'Select affordable guards based on inspection.' };
  } };
  const successful = await runBenchmark(oneTask, { policy });
  assert.ok(successful.cases[0].runs.every(run => run.metrics.firstAttemptSuccess));
  const successfulTable = textOf(scoreTable(successful));
  assert.match(successfulTable, /— No eligible failures/);
  assert.doesNotMatch(successfulTable, /0 \/ 0 eligible failures/);
  assert.match(successfulTable, /1 \/ 1 100%/);
});

test('browser views retain policy errors as unscored attempts rather than displaying a zero score', async () => {
  const report = await runBenchmark(oneTask, { policy: { decide() { throw new ModelError('Fixture provider error.', 'MODEL_INCOMPLETE'); } } });
  assert.equal(report.status, 'completed_with_errors');
  const run = runFor(report, 'forward_only'), attempt = run.attempts[0];
  assert.equal(attempt.score, null);
  const table = textOf(scoreTable(report));
  assert.match(table, /— 0 \/ 1 scored 1/);
  assert.match(textOf(stepDetail(attempt.steps[0])), /No completed checkpoints/);
  assert.equal(gateChecks(attempt), '');
  assert.doesNotMatch(JSON.stringify(report), /Fixture provider error/);
});

test('model rationales, analyst text and task observations render as escaped text', async () => {
  const attack = '<img src="x" onerror=\'alert(1)\'> & <script>bad()</script>';
  const fixture = createReferencePolicy();
  const analyst = context => {
    const output = fixture.reflect(context);
    return { ...output, summary: attack, recommendations: output.recommendations.map(item => ({ ...item, reasoning: attack })) };
  };
  const policy = { async decide(context) { return { ...await fixture.decide(context), reasoning: attack }; }, reflect: analyst, invert: analyst };
  const report = await runBenchmark(oneTask, { policy });
  const run = runFor(report, 'reflection');
  const step = structuredClone(run.attempts[0].steps[0]);
  step.observation = attack; step.result = attack; step.action.description = attack; step.checkpointId = attack;
  const attempt = structuredClone(run.attempts[0]);
  attempt.outcome.checks[0].id = attack; attempt.outcome.checks[0].observation = attack;
  const views = [stepDetail(step), gateChecks(attempt), analysisDetails(run, run.attempts[1])];
  for (const markup of views) {
    assert.doesNotMatch(markup, /<img|<script>/);
    assert.match(markup, /&lt;img/);
    assert.match(markup, /&amp;/);
    assert.match(markup, /&quot;x&quot;/);
    assert.match(markup, /&#39;alert\(1\)&#39;/);
  }
});

test('browser replay evidence preserves rejected controls and distinguishes local repair from final success', async () => {
  const report = await runBenchmark(oneTask);
  const run = runFor(report, 'reflection');
  assert.ok(run.analyses[0].candidateTests.some(candidate => !candidate.accepted && candidate.replay));
  assert.ok(run.analyses[0].candidateTests.some(candidate => candidate.accepted && !candidate.replay.outcome.success));
  const evidence = textOf(analysisDetails(run, run.attempts[1]));
  assert.match(evidence, /Rejected/);
  assert.match(evidence, /Verified local repair/);
  assert.match(evidence, /Full task after replay: unsuccessful/);
  assert.match(evidence, /Introduced: none/);
  assert.match(evidence, /Notes available on attempt 2/);
  assert.match(textOf(analysisDetails(run, run.attempts[0])), /No verified notes were delivered/);
});

test('browser cost cards keep physical forward and replay actions separate from effort and model tokens', async () => {
  const report = await runBenchmark(oneTask);
  const cards = textOf(costCards(report));
  assert.match(cards, new RegExp(`${report.costs.physicalForwardActions} actions`));
  assert.match(cards, new RegExp(`${report.costs.replayActions} actions`));
  assert.match(cards, /shared source charged once/);
  assert.match(cards, /includes rejected proposals/);
  assert.match(cards, /Offline fixture/);
  assert.doesNotMatch(cards, /dollars|USD|\$/);
  const custom = await runBenchmark({ ...oneTask, attempts: 1 }, { policy: createReferencePolicy() });
  assert.equal(custom.options.policyKind, 'custom');
  assert.equal(custom.costs.modelUsage, null);
  const unreported = textOf(costCards(custom));
  assert.match(unreported, /Unreported/);
  assert.doesNotMatch(unreported, /No model calls|Offline fixture/);
});

test('saved report import accepts complete reports and rejects executable-looking field substitutions', async () => {
  const report = await runBenchmark({ ...oneTask, attempts: 1 });
  assert.equal(validateSavedReport(JSON.parse(JSON.stringify(report))).kind, 'temporal_benchmark');
  for (const mutate of [
    r => { r.kind = 'arbitrary'; },
    r => { r.schemaVersion = 999; },
    r => { r.cases = []; },
    r => { r.cases[0].runs[0].attempts[0].steps[0].checkpointId = {}; },
    r => { r.summary[0].firstAttemptSuccesses = '<img src=x onerror=alert(1)>'; },
    r => { r.reportHash = '../outside'; },
    r => { r.cases[0].runs[0].attempts[0].steps[0].actions = null; },
  ]) {
    const unsafe = structuredClone(report); mutate(unsafe);
    assert.throws(() => validateSavedReport(unsafe), /not a supported Turnstile report/);
  }
  const textOnly = structuredClone(report);
  textOnly.cases[0].runs[0].attempts[0].steps[0].reasoning = '<script>bad()</script>';
  validateSavedReport(textOnly);
  assert.doesNotMatch(stepDetail(textOnly.cases[0].runs[0].attempts[0].steps[0]), /<script>/);
});

test('import retains legacy schema reports and validates every nested validation condition', async () => {
  const current = await runBenchmark({ ...oneTask, attempts: 1 });
  const legacy = structuredClone(current);
  legacy.schemaVersion = 1;
  for (const run of legacy.cases[0].runs) for (const attempt of run.attempts) {
    delete attempt.automaticActions; delete attempt.policyDecisions;
    for (const step of attempt.steps) delete step.execution;
  }
  assert.equal(validateSavedReport(legacy).schemaVersion, 1);
  const schemaThree = structuredClone(current); schemaThree.schemaVersion = 3;
  assert.equal(validateSavedReport(schemaThree).schemaVersion, 3);
  const schemaTwo = structuredClone(current); schemaTwo.schemaVersion = 2;
  assert.equal(validateSavedReport(schemaTwo).schemaVersion, 2);
  assert.match(textOf(stepDetail(legacy.cases[0].runs[0].attempts[0].steps[0])), /Execution source not recorded/);
  const validation = { kind: 'temporal_validation', schemaVersion: 1, reportHash: 'a'.repeat(64), pairs: [], conditions: [{ id: 'early', family: 'delayed_consequences', report: current }] };
  assert.equal(validateSavedReport(validation).conditions.length, 1);
  validation.conditions.push({ id: 'late', family: 'delayed_consequences', report: { kind: 'temporal_benchmark' } });
  assert.throws(() => validateSavedReport(validation), /not a supported Turnstile report/);
});

test('matched validation imports show signed descriptive deltas and incomplete-pair coverage', async () => {
  const report = await runValidation({ suite: 'temporal', attempts: 1, strategies: ['forward_only'] });
  assert.equal(validateSavedReport(report).conditions.length, 4);
  const text = textOf(validationSummary(report));
  assert.match(text, /treatment minus control/);
  assert.match(text, /no significance or causal advantage/);
  assert.match(validationSummary(report), /aria-label="Primary temporal diagnostic"/);
  assert.match(text, /stronger temporal diagnostic than individual query accuracy/);
  assert.match(text, /required flips correct in both conditions/);
  assert.match(text, /Temporal-only audit: passed/);
  assert.match(text, /1 \/ 1 first/);
  const incomplete = structuredClone(report);
  Object.assign(incomplete.pairs[0].summary[0], { completeFirstPairs: 0, completeFinalPairs: 0, meanFirstAttemptScoreDelta: null, meanFinalScoreDelta: null, requiredFlipQueries: 0, bothCorrectFlipQueries: 0, pairedTemporalAccuracy: null, controlErrors: 1 });
  const display = textOf(validationSummary(validateSavedReport(incomplete)));
  assert.match(display, /— — — 0 \/ 0 required flips 0 \/ 1 first 0 \/ 1 final 1 \/ 0/);
  incomplete.pairs[0].summary[0].meanFirstAttemptScoreDelta = '<script>bad()</script>';
  assert.throws(() => validateSavedReport(incomplete), /not a supported Turnstile report/);
  const unsafePair = structuredClone(report);
  unsafePair.pairs[0].summary[0].pairedTemporalAccuracy = '<script>bad()</script>';
  assert.throws(() => validateSavedReport(unsafePair), /not a supported Turnstile report/);
});

test('focused temporal reports expose first-attempt accuracy independently of assisted final scores', async () => {
  const report = await runBenchmark({ taskId: 'temporal_history', attempts: 1 });
  assert.equal(report.schemaVersion, 4);
  assert.equal(validateSavedReport(report).options.suite, 'temporal');
  const unassisted = report.cases[0].runs[0].attempts[0].score;
  const changedFinal = structuredClone(report);
  changedFinal.summary.forEach(row => { row.meanFinalScore = 1; });
  const display = textOf(scoreTable(changedFinal));
  assert.match(display, /FIRST SCORE FIRST PASS/);
  assert.ok(display.includes(`${Math.round(unassisted * 100)}% Unassisted`));
  assert.match(display, /100% 1 \/ 1 scored/);
  assert.doesNotMatch(textOf(validationSummary(await runValidation({ suite: 'temporal' }))), /Delayed-family/);
});

test('dynamics views score six fresh predictions separately from observed calibration and recovery', async () => {
  const report = await runBenchmark();
  assert.equal(report.options.suite, 'dynamics');
  assert.equal(validateSavedReport(report).schemaVersion, 4);
  const attempt = report.cases[0].runs[0].attempts[0];
  assert.equal(attempt.steps.filter(step => step.phase === 'calibration').length, 3);
  assert.equal(attempt.steps.filter(step => step.phase === 'forecast').length, 6);
  const table = textOf(scoreTable(report));
  assert.match(table, /PREDICTION ACCURACY ALL SIX CORRECT/);
  assert.doesNotMatch(table, /RECOVERY|FINAL SCORE/);
  assert.match(textOf(stepDetail(attempt.steps[0])), /OBSERVED CALIBRATION .*not scored/);
  assert.match(textOf(stepDetail(attempt.steps[3])), /UNSEEN-FUTURE PREDICTION .*scored query/);
  assert.match(textOf(stepDetail(attempt.steps[3])), /Committed prediction/);
  const unsafe = structuredClone(report);
  unsafe.cases[0].runs[0].attempts[0].steps[0].phase = '<script>bad()</script>';
  assert.throws(() => validateSavedReport(unsafe), /not a supported Turnstile report/);
  const validation = await runValidation();
  assert.equal(validateSavedReport(validation).schemaVersion, 3);
  const display = textOf(validationSummary(validation));
  assert.match(display, /Provided-rule conditions supply the mechanism/);
  assert.match(display, /six fresh prediction queries/);
  assert.doesNotMatch(display, /stronger temporal diagnostic than individual query accuracy/);
});

test('dynamics imports expose a collapsed escaped public brief and reject malformed mechanism fields', async () => {
  const report = await runBenchmark({ ruleAccess: 'given' });
  const item = validateSavedReport(report).cases[0];
  assert.equal(item.brief.ruleAccess, 'given');
  assert.equal(item.brief.candidateMechanisms.length, 6);
  assert.ok(item.brief.providedMechanism);
  const recorded = structuredClone(item.brief);
  recorded.rules.push('<img src=x onerror="bad()"> & public rule');
  const markup = taskBriefDetails(recorded);
  assert.match(markup, /<details[^>]*><summary>Public task brief · provided-rule control/);
  assert.doesNotMatch(markup, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(markup, /candidateMechanisms/);
  assert.match(markup, /providedMechanism/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img/);
  for (const mutate of [
    value => { value.cases[0].brief.rules = {}; },
    value => { value.cases[0].brief.candidateMechanisms[0].delay = '<script>bad()</script>'; },
    value => { value.cases[0].brief.providedMechanism.retrigger = {}; },
    value => { value.cases[0].brief.answerKey = ['hidden']; },
  ]) {
    const unsafe = structuredClone(report); mutate(unsafe);
    assert.throws(() => validateSavedReport(unsafe), /not a supported Turnstile report/);
  }
  const withoutBrief = structuredClone(report); delete withoutBrief.cases[0].brief;
  assert.equal(validateSavedReport(withoutBrief).schemaVersion, 4);
  assert.equal(taskBriefDetails(withoutBrief.cases[0].brief), '');
});

test('automatic actions and policy choices remain distinct in recorded step and physical costs', async () => {
  const report = await runBenchmark({ ...oneTask, attempts: 1 });
  const step = report.cases[0].runs[0].attempts[0].steps[0];
  assert.match(textOf(stepDetail({ ...step, execution: 'automatic' })), /Automatic — sole legal action; no policy call/);
  assert.match(textOf(stepDetail({ ...step, execution: 'policy' })), /Policy decision/);
  const costs = { ...report, costs: { ...report.costs, physicalAutomaticActions: 10, physicalPolicyDecisions: 4 } };
  assert.match(textOf(costCards(costs)), /4 policy choices · 10 automatic actions/);
});
