// Browser-only presentation helpers. No evaluator or model transport is imported.
export const STRATEGY_LABELS = { forward_only: 'Unassisted / fresh retry', trace_memory: 'Trace memory', reflection: 'Reflection', temporal_pincer: 'Temporal pincer' };
export const STRATEGY_DESCRIPTIONS = { forward_only: 'Primary first attempt; later retries have no previous-attempt memory', trace_memory: 'Optional recovery with completed previous traces', reflection: 'Optional recovery with verified notes at retry start', temporal_pincer: 'Optional recovery with verified notes at matching checkpoints' };
export const FAMILY_LABELS = { all: 'All families', dynamics_learning: 'Dynamics learning', delayed_consequences: 'Delayed consequences', temporal_state_tracking: 'Temporal state tracking' };
export const SPLIT_LABELS = { development: 'Development', evaluation: 'Public evaluation', all: 'All public tasks' };
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const number = value => Number.isFinite(value) ? value.toLocaleString('en-US') : 'Unreported';
export const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
export const strategyName = id => STRATEGY_LABELS[id] ?? id;
const e = escapeHTML;
export function taskBriefDetails(brief) {
  if (!brief) return '';
  return `<details class="report-details task-brief"><summary>Public task brief · ${brief.ruleAccess === 'given' ? 'provided-rule control' : 'infer from calibration'}</summary><p>${e(brief.objective)}</p><p>Recorded initial public instructions, candidate mechanisms and any provided-rule control. This contains no evaluator answers; current observations and history appear at each checkpoint.</p><pre>${e(JSON.stringify(brief, null, 2))}</pre></details>`;
}
export function scoreTable(report, family = 'all') {
  const rows = report.summary.filter(r => r.family === family);
  const firstScore = row => {
    if (Object.hasOwn(row, 'meanFirstAttemptScore')) return row.meanFirstAttemptScore;
    const completed = report.cases.filter(c => family === 'all' || c.family === family).flatMap(c => c.runs.filter(run => run.strategy === row.strategy).map(run => run.attempts[0].score)).filter(Number.isFinite);
    return completed.length ? completed.reduce((sum, value) => sum + value, 0) / completed.length : null;
  };
  if (report.options.suite === 'dynamics') return `<div class="table-scroll"><table><caption class="sr-only">Unseen-future prediction results. Calibration examples are not scored.</caption><thead><tr><th scope="col">POLICY</th><th scope="col">PREDICTION ACCURACY</th><th scope="col">ALL SIX CORRECT</th><th scope="col">SCORED CASES</th><th scope="col">ERRORS</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">Unassisted</th><td class="mono">${percent(firstScore(row))}<small>Fresh-run queries only</small></td><td class="mono">${row.firstAttemptSuccesses} / ${row.cases}<small>${percent(row.firstAttemptSuccessRate)}</small></td><td class="mono">${row.scoredCases} / ${row.cases}</td><td class="mono ${row.errors ? 'bad' : ''}">${row.errors}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="table-scroll"><table><caption class="sr-only">Strategy results for ${e(FAMILY_LABELS[family])}. First score and first pass are unassisted; recovery rates use failed completed first attempts only.</caption><thead><tr><th scope="col">STRATEGY</th><th scope="col">FIRST SCORE</th><th scope="col">FIRST PASS</th><th scope="col">FINAL PASS</th><th scope="col">RECOVERY</th><th scope="col">FINAL SCORE</th><th scope="col">ERRORS</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${e(strategyName(r.strategy))}</th><td class="mono">${percent(firstScore(r))}<small>Unassisted</small></td><td class="mono">${r.firstAttemptSuccesses} / ${r.cases}<small>${percent(r.firstAttemptSuccessRate)}</small></td><td class="mono ${r.finalSuccesses ? 'good' : ''}">${r.finalSuccesses} / ${r.cases}<small>${percent(r.finalSuccessRate)}</small></td><td class="mono">${percent(r.recoveryRate)}<small>${r.recoveryEligible ? `${r.recoveries} / ${r.recoveryEligible} eligible failures` : 'No eligible failures'}</small></td><td class="mono">${percent(r.meanFinalScore)}<small>${r.scoredCases} / ${r.cases} scored</small></td><td class="mono ${r.errors ? 'bad' : ''}">${r.errors}</td></tr>`).join('')}</tbody></table></div>`;
}
export function costCards(report) {
  const c = report.costs, u = c.modelUsage;
  const tokens = u && Number.isFinite(u.totalTokens) ? `${number(u.totalTokens)} reported tokens` : 'Token usage unreported';
  const execution = Number.isFinite(c.physicalAutomaticActions) && Number.isFinite(c.physicalPolicyDecisions) ? `${number(c.physicalPolicyDecisions)} policy choices · ${number(c.physicalAutomaticActions)} automatic actions` : 'Execution-source counts unavailable in this report';
  const reportedCost = Number.isFinite(u?.reportedCostUSD) ? ` Provider-reported cost: US$${u.reportedCostUSD.toFixed(6)}.` : '';
  return `<article class="cost-card"><h3>Forward execution</h3><p class="cost-value">${number(c.physicalForwardActions)} actions</p><p>${number(c.physicalForwardEffort)} effort · shared source charged once</p><p>${execution}</p></article>
    <article class="cost-card"><h3>Evaluator replay</h3><p class="cost-value">${number(c.replayActions)} actions</p><p>${number(c.replayEffort)} effort · includes rejected proposals</p></article>
    <article class="cost-card"><h3>Model usage</h3><p class="cost-value">${u ? `${number(u.calls)} calls` : report.options.policyKind === 'reference' ? 'Offline fixture' : 'Unreported'}</p><p>${u ? `${tokens}${u.unreportedUsageCalls ? ` · ${number(u.unreportedUsageCalls)} responses without usage` : ''}.${reportedCost} Provider billing can differ.` : report.options.policyKind === 'reference' ? 'No model calls in reference mode' : 'The model adapter did not report usage'}</p></article>`;
}
export function validationSummary(report) {
  const delta = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${Math.round(v * 100)} pp` : '—';
  const dynamics = report.conditions.every(condition => condition.report.options.suite === 'dynamics');
  if (dynamics) {
    const conditions = report.conditions.flatMap(condition => condition.report.summary.filter(row => row.family === 'all').map(row => `<article class="cost-card"><h3>${e(condition.id.replaceAll('_', ' '))}</h3><p class="cost-value">${percent(row.meanFirstAttemptScore)}</p><p>Unseen-future prediction accuracy · ${number(row.scoredCases)} / ${number(row.cases)} scored cases</p></article>`));
    const comparisons = report.pairs.flatMap(pair => pair.summary.map(row => `<tr><th scope="row">${e(pair.id.replaceAll('_', ' '))}<small>${e(pair.control)} → ${e(pair.treatment)}</small></th><td class="mono">${delta(row.meanFirstAttemptScoreDelta)}</td><td class="mono">${number(row.completeFirstPairs)} / ${number(row.pairedCases)}</td><td class="mono">${number(row.controlErrors)} / ${number(row.treatmentErrors)}</td></tr>`));
    const timing = report.pairs.filter(pair => pair.temporalNecessity?.answerChangeExpected).flatMap(pair => pair.summary.map(row => `<li>${e(pair.id.replaceAll('_', ' '))}: ${percent(row.pairedTemporalAccuracy)}<small> · ${number(row.bothCorrectFlipQueries)} / ${number(row.requiredFlipQueries)} required flips correct in both conditions</small></li>`)).join('');
    return `<section class="temporal-pair-summary" aria-label="Dynamics learning controls"><h3>Learning and applying delayed dynamics</h3><p class="fine">Inferred-rule conditions require learning from the three observed calibration runs. Provided-rule conditions supply the mechanism. Scores below concern only the six fresh prediction queries. Timing contrasts change one query horizon; rule-access contrasts help distinguish learning from applying a known rule.</p><div class="pair-cards">${conditions.join('')}</div><details class="validation-deltas"><summary>Matched differences and coverage</summary><p class="fine">Changes are treatment minus control in percentage points of prediction accuracy. Only complete matched pairs contribute; no significance or causal advantage is inferred. Conditions share a task structure, not model-generated responses. Missing pairs remain in coverage and error counts.</p><div class="table-scroll"><table><thead><tr><th scope="col">COMPARISON</th><th scope="col">PREDICTION ACCURACY Δ</th><th scope="col">COMPLETE PAIRS</th><th scope="col">ERRORS C / T</th></tr></thead><tbody>${comparisons.join('')}</tbody></table></div><h4>Timing sensitivity control (secondary)</h4><p class="fine">Only the first query horizon changes. That contrast can be solved without learning the mechanism; all six forecast answers remain the primary learning measurement.</p><ul>${timing}</ul></details></section>`;
  }
  const focused = report.conditions.every(condition => condition.report.schemaVersion >= 3 && condition.report.options.suite === 'temporal');
  const rows = report.pairs.flatMap(pair => pair.summary.map(row => {
    const answerBehavior = pair.temporalNecessity?.answerChangeExpected
      ? `${percent(row.pairedTemporalAccuracy)}<small>${number(row.bothCorrectFlipQueries)} / ${number(row.requiredFlipQueries)} required flips</small>`
      : '—<small>Answer-invariance control</small>';
    const audit = pair.temporalNecessity?.answerChangeExpected ? `<small>Temporal-only audit: ${pair.temporalNecessity.onlyTemporalMetadataChanged ? 'passed' : 'unavailable or failed'}</small>` : '';
    return `<tr><th scope="row">${e(pair.id.replaceAll('_', ' '))}<small>${e(pair.control)} → ${e(pair.treatment)}</small>${audit}</th><td>${e(strategyName(row.strategy))}</td><td class="mono">${delta(row.meanFirstAttemptScoreDelta)}</td><td class="mono">${delta(row.meanFinalScoreDelta)}</td>${focused ? `<td class="mono">${answerBehavior}</td>` : ''}<td class="mono">${number(row.completeFirstPairs)} / ${number(row.pairedCases)} first<small>${number(row.completeFinalPairs)} / ${number(row.pairedCases)} final</small></td><td class="mono">${number(row.controlErrors)} / ${number(row.treatmentErrors)}</td></tr>`;
  }));
  const explanation = focused
    ? 'Timestamp-only variants must change at least one expected answer; irrelevant observations must preserve expected answers. Paired temporal accuracy requires both answers to be correct at every required flip; merely changing an answer earns no credit. It is unassisted and null for incomplete temporal pairs or noise controls.'
    : 'Historical protocol. Delayed-family first-attempt contrasts are negative controls: choices precede the changed probe and distractions. Keep these results separate from the focused temporal suite.';
  const temporalHeadline = focused ? `<section class="temporal-pair-summary" aria-label="Primary temporal diagnostic"><h3>Paired temporal accuracy</h3><p class="fine">Both unassisted answers must be correct when timestamps require an answer to change. This is a stronger temporal diagnostic than individual query accuracy, which a timestamp-blind shortcut can score highly on.</p><div class="pair-cards">${report.pairs.filter(pair => pair.temporalNecessity?.answerChangeExpected).flatMap(pair => pair.summary.map(row => `<article class="cost-card"><h3>${e(pair.id.replaceAll('_', ' '))} · ${e(strategyName(row.strategy))}</h3><p class="cost-value">${percent(row.pairedTemporalAccuracy)}</p><p>${number(row.bothCorrectFlipQueries)} / ${number(row.requiredFlipQueries)} required flips correct in both conditions</p><p>${number(row.completeFirstPairs)} / ${number(row.pairedCases)} complete first-attempt pairs</p></article>`)).join('')}</div><p class="fine">These overlapping descriptive contrasts are shown separately. Missing pairs remain in coverage and error counts; no model ranking or significance is inferred.</p></section>` : '';
  return `${temporalHeadline}<details class="validation-deltas"><summary>Matched differences across the suite</summary><p class="fine">Changes are treatment minus control in percentage points of answer score. Only complete matched pairs contribute. These overlapping comparisons are descriptive; no significance or causal advantage is inferred. ${explanation}</p><div class="table-scroll"><table><caption class="sr-only">Matched control differences, paired temporal accuracy, coverage and control/treatment error counts</caption><thead><tr><th scope="col">COMPARISON</th><th scope="col">STRATEGY</th><th scope="col">FIRST SCORE Δ</th><th scope="col">FINAL SCORE Δ</th>${focused ? '<th scope="col">PAIRED TEMPORAL ACCURACY</th>' : ''}<th scope="col">COMPLETE PAIRS</th><th scope="col">ERRORS C / T</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}
export function stepDetail(step) {
  if (!step) return '<div class="notice">No completed checkpoints in this attempt. Inspect the error above.</div>';
  const execution = step.execution === 'automatic' ? 'Automatic — sole legal action; no policy call' : step.execution === 'policy' ? 'Policy decision' : 'Execution source not recorded (legacy report)';
  const phase = step.phase === 'calibration' ? '<p class="phase-note">OBSERVED CALIBRATION · completed example, not scored</p>' : step.phase === 'forecast' ? '<p class="phase-note forecast">UNSEEN-FUTURE PREDICTION · scored query</p>' : '';
  return `<article class="step-card">${phase}<div class="step-header"><h3>${e(step.checkpointId.replaceAll('_', ' '))}</h3><span class="pill">CHECKPOINT ${step.t}</span></div><p class="execution-note">${execution}</p><div class="step-columns"><div class="detail-block"><p class="detail-label">Observation before decision</p><p class="detail-text">${e(step.observation)}</p></div><div><div class="detail-block"><p class="detail-label">${step.phase === 'forecast' ? 'Committed prediction' : 'Chosen action'}</p><p class="detail-text">${e(step.action.description ?? step.action.id)}</p><p class="rationale">${e(step.reasoning)}</p></div><div class="detail-block"><p class="detail-label">Observed result</p><p class="detail-text">${e(step.result)}</p></div></div></div>${step.injectedHints?.length ? `<div class="feedback"><p class="detail-label">Pincer notes delivered here</p>${step.injectedHints.map(c => `<p>From attempt ${c.sourceAttempt}: ${e(c.actionId)} — ${e(c.reasoning)}</p>`).join('')}</div>` : ''}<details class="report-details"><summary>Available actions &amp; recorded fields</summary><pre>${e(JSON.stringify(step, null, 2))}</pre></details></article>`;
}
export function gateChecks(attempt) {
  if (!attempt.outcome) return '';
  return `<ul class="gate-list" aria-label="Automatically scored gates">${attempt.outcome.checks.map(c => `<li><span class="${c.passed ? 'good' : 'bad'}">${c.passed ? 'PASS' : 'FAIL'}</span>${e(c.id.replaceAll('_', ' '))}<small>${e(c.observation)}</small></li>`).join('')}</ul>`;
}
export function analysisDetails(run, attempt) {
  const delivered = attempt.deliveries.flatMap(d => d.cards.map(c => ({ ...c, deliveredAt: d.t })));
  return `<details class="analysis-section"><summary>Feedback &amp; replay evidence · ${run.analyses.length} analysis round${run.analyses.length === 1 ? '' : 's'}</summary>
    ${delivered.length ? `<div class="analysis-round"><h3>Notes available on attempt ${attempt.index}</h3>${delivered.map(c => `<p>At checkpoint ${c.deliveredAt}, from attempt ${c.sourceAttempt}: ${e(c.checkpointId)} → ${e(c.actionId)}. ${e(c.reasoning)}</p>`).join('')}</div>` : '<p class="muted">No verified notes were delivered on this attempt.</p>'}
    ${run.analyses.map(a => `<section class="analysis-round"><h3>After attempt ${a.sourceAttempt} · ${e(a.traversal)} analysis</h3><p>${e(a.summary ?? 'Analysis did not complete.')} ${a.replays}/${a.budget} replays · ${number(a.replayActions)} replay actions</p>${a.error ? `<p class="bad">${e(a.error.code)}: ${e(a.error.message)}</p>` : ''}${a.candidateTests.map(t => `<details class="proposal ${t.accepted ? 'accepted' : 'rejected'}"><summary>${t.accepted ? 'Verified local repair' : 'Rejected'} · checkpoint ${e(t.proposal.targetT)} → ${e(t.proposal.actionId)}</summary><p>${e(t.proposal.reasoning)}</p><p>Result: ${e(t.reason.replaceAll('_', ' '))}. ${t.replay ? `Full task after replay: ${t.replay.outcome.success ? 'success' : 'unsuccessful'}. Removed: ${e(t.removedFailureIds.join(', ') || 'none')}. Introduced: ${e(t.introducedFailureIds.join(', ') || 'none')}.` : 'No replay executed.'}</p><pre>${e(JSON.stringify(t, null, 2))}</pre></details>`).join('')}</section>`).join('')}
    <p class="fine">Analysis uses completed earlier attempts. Verified local repairs can leave other failures. All rounds, including those after the selected attempt, are shown here for inspection.</p></details>`;
}

/** Reject malformed local JSON before it reaches renderers. Imports never run code. */
export function validateSavedReport(value) {
  const fail = () => { throw new Error('This file is not a supported Turnstile report. Open a complete benchmark or validation JSON export (benchmark schema 1–4).'); };
  const object = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string';
  const count = v => Number.isInteger(v) && v >= 0;
  const finite = v => Number.isFinite(v) && v >= 0;
  const score = v => v === null || (Number.isFinite(v) && v >= 0 && v <= 1);
  const array = (v, max) => Array.isArray(v) && v.length <= max;
  const error = v => v == null || (object(v) && text(v.code) && text(v.message));
  const note = v => object(v) && text(v.checkpointId) && count(v.targetT) && text(v.actionId) && text(v.reasoning) && count(v.sourceAttempt);
  const action = v => object(v) && text(v.id) && (v.description == null || text(v.description));
  const check = v => object(v) && text(v.id) && typeof v.passed === 'boolean' && text(v.observation);
  const mechanism = v => object(v) && Object.keys(v).every(key => ['delay', 'retrigger'].includes(key))
    && Number.isSafeInteger(v.delay) && v.delay > 0 && ['restart', 'ignore'].includes(v.retrigger);
  const brief = v => object(v) && Object.keys(v).every(key => ['taskType', 'ruleAccess', 'objective', 'candidateMechanisms', 'providedMechanism', 'rules', 'effortBudget'].includes(key))
    && v.taskType === 'dynamics_learning' && ['infer', 'given'].includes(v.ruleAccess) && text(v.objective)
    && array(v.rules, 100) && v.rules.length > 0 && v.rules.every(text)
    && array(v.candidateMechanisms, 20) && v.candidateMechanisms.length > 0 && v.candidateMechanisms.every(mechanism)
    && (v.effortBudget === null || finite(v.effortBudget))
    && (v.ruleAccess === 'infer' ? v.providedMechanism === null : mechanism(v.providedMechanism));
  function benchmark(r) {
    if (!object(r) || r.kind !== 'temporal_benchmark' || ![1, 2, 3, 4].includes(r.schemaVersion) || !text(r.benchmarkVersion) || !['completed', 'completed_with_errors'].includes(r.status)
      || !text(r.reportHash) || !/^[a-f0-9]{64}$/.test(r.reportHash) || !object(r.options) || !count(r.options.seed) || !count(r.options.seedCount) || !count(r.options.attempts) || !text(r.options.policyKind)
      || !object(r.provenance) || !object(r.provenance.model) || !text(r.provenance.sourceHash) || !text(r.provenance.runtime) || !text(r.provenance.platform)
      || !array(r.limitations, 100) || !r.limitations.every(text) || !object(r.protocol) || !object(r.costs)
      || !['physicalForwardActions', 'physicalForwardEffort', 'replayActions', 'replayEffort'].every(k => finite(r.costs[k]))
      || !array(r.summary, 100) || !array(r.cases, 500) || !r.cases.length) fail();
    for (const row of r.summary) {
      if (!object(row) || !text(row.family) || !text(row.strategy)
        || !['firstAttemptSuccesses', 'finalSuccesses', 'cases', 'recoveries', 'recoveryEligible', 'scoredCases', 'errors'].every(k => count(row[k]))
        || !['firstAttemptSuccessRate', 'finalSuccessRate', 'recoveryRate', 'meanFinalScore'].every(k => score(row[k]))) fail();
      if (Object.hasOwn(row, 'meanFirstAttemptScore') && !score(row.meanFirstAttemptScore)) fail();
    }
    for (const item of r.cases) {
      if (!object(item) || !text(item.taskId) || !text(item.family) || !count(item.seed) || !array(item.runs, 20) || !item.runs.length) fail();
      if (Object.hasOwn(item, 'brief') && (r.options.suite !== 'dynamics' || !brief(item.brief))) fail();
      for (const run of item.runs) {
        if (!object(run) || !text(run.strategy) || !array(run.attempts, 5) || !run.attempts.length || !array(run.analyses, 5)) fail();
        for (const attempt of run.attempts) {
          if (!object(attempt) || !count(attempt.index) || !['completed', 'error'].includes(attempt.status) || typeof attempt.success !== 'boolean' || !score(attempt.score) || !finite(attempt.effort)
            || !error(attempt.error) || !array(attempt.steps, 128) || !array(attempt.deliveries, 128)) fail();
          if (attempt.outcome !== null && (!object(attempt.outcome) || !array(attempt.outcome.checks, 128) || !attempt.outcome.checks.every(check))) fail();
          for (const delivery of attempt.deliveries) if (!object(delivery) || !count(delivery.t) || !array(delivery.cards, 100) || !delivery.cards.every(note)) fail();
          for (const step of attempt.steps) if (!object(step) || !count(step.t) || !text(step.checkpointId) || !text(step.observation) || !text(step.reasoning) || !text(step.result)
            || !action(step.action) || !array(step.actions, 100) || !step.actions.every(action) || !array(step.injectedHints, 100) || !step.injectedHints.every(note)
            || (Object.hasOwn(step, 'phase') && !['calibration', 'forecast'].includes(step.phase))) fail();
        }
        for (const analysis of run.analyses) {
          if (!object(analysis) || !count(analysis.sourceAttempt) || !text(analysis.traversal) || (analysis.summary != null && !text(analysis.summary)) || !error(analysis.error)
            || !['replays', 'budget', 'replayActions'].every(k => count(analysis[k])) || !array(analysis.candidateTests, 100)) fail();
          for (const candidate of analysis.candidateTests) {
            if (!object(candidate) || typeof candidate.accepted !== 'boolean' || !text(candidate.reason) || !object(candidate.proposal)
              || !count(candidate.proposal.targetT) || !text(candidate.proposal.actionId) || !text(candidate.proposal.reasoning)) fail();
            if (candidate.replay != null && (!object(candidate.replay) || !object(candidate.replay.outcome) || typeof candidate.replay.outcome.success !== 'boolean'
              || !array(candidate.removedFailureIds, 128) || !candidate.removedFailureIds.every(text) || !array(candidate.introducedFailureIds, 128) || !candidate.introducedFailureIds.every(text))) fail();
          }
        }
      }
    }
  }
  if (value?.kind === 'temporal_validation') {
    if (!object(value) || ![1, 2, 3].includes(value.schemaVersion) || !text(value.reportHash) || !/^[a-f0-9]{64}$/.test(value.reportHash) || !array(value.conditions, 32) || !value.conditions.length || !array(value.pairs, 32)) fail();
    for (const condition of value.conditions) {
      if (!object(condition) || !text(condition.id) || !text(condition.family)) fail();
      benchmark(condition.report);
    }
    for (const pair of value.pairs) {
      if (!object(pair) || !text(pair.id) || !text(pair.control) || !text(pair.treatment) || !array(pair.summary, 20)) fail();
      if (pair.temporalNecessity != null) {
        const audit = pair.temporalNecessity;
        if (!object(audit) || ![true, false, null].includes(audit.onlyTemporalMetadataChanged) || typeof audit.answerChangeExpected !== 'boolean'
          || !array(audit.changedQueriesPerCase, 500) || !audit.changedQueriesPerCase.every(item => object(item) && text(item.taskId) && count(item.seed) && count(item.changedQueryCount) && array(item.changedCheckpoints, 128) && item.changedCheckpoints.every(text))) fail();
      }
      for (const row of pair.summary) if (!object(row) || !text(row.strategy)
        || !['pairedCases', 'completeFirstPairs', 'completeFinalPairs', 'controlErrors', 'treatmentErrors'].every(k => count(row[k]))
        || !['meanFirstAttemptScoreDelta', 'meanFinalScoreDelta'].every(k => row[k] === null || (Number.isFinite(row[k]) && row[k] >= -1 && row[k] <= 1))
        || (Object.hasOwn(row, 'pairedTemporalAccuracy') && (!score(row.pairedTemporalAccuracy) || !count(row.requiredFlipQueries) || !(row.bothCorrectFlipQueries === null || count(row.bothCorrectFlipQueries))))) fail();
    }
  } else benchmark(value);
  return value;
}
