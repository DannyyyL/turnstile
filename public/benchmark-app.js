import { STRATEGY_LABELS, STRATEGY_DESCRIPTIONS, FAMILY_LABELS, SPLIT_LABELS, escapeHTML as e, number, percent, strategyName, scoreTable, costCards, stepDetail, gateChecks, analysisDetails, taskBriefDetails, validateSavedReport, validationSummary } from './benchmark-view.js';

const $ = id => document.getElementById(id);
const state = { config: null, document: null, report: null, conditionIndex: 0, imported: false, caseIndex: 0, strategy: null, attemptIndex: 0, stepIndex: 0, controller: null };
const option = (value, text, disabled = false) => `<option value="${e(value)}"${disabled ? ' disabled' : ''}>${e(text)}</option>`;
const currentCase = () => state.report?.cases[state.caseIndex];
const currentRun = () => currentCase()?.runs.find(r => r.strategy === state.strategy);
const currentAttempt = () => currentRun()?.attempts[state.attemptIndex];
const allTasks = () => [...(state.config?.tasks ?? []), ...(state.config?.temporalTasks ?? []), ...(state.config?.legacyTasks ?? [])];
const taskName = id => allTasks().find(t => t.id === id)?.label ?? id;
const dynamicsSelected = () => $('suite').value === 'dynamics';

function updateTasks() {
  const dynamics = dynamicsSelected();
  if (dynamics) $('split').value = 'development';
  $('split').disabled = dynamics;
  const old = $('task').value, split = $('split').value, suite = $('suite').value;
  const tasks = allTasks().filter((t, i, list) => list.findIndex(item => item.id === t.id) === i && (t.suite ?? 'temporal') === suite && (split === 'all' || (t.split ?? 'development') === split));
  $('task').innerHTML = option('', `All ${tasks.length} matching tasks`) + tasks.map(t => option(t.id, t.label)).join('');
  if (tasks.some(t => t.id === old)) $('task').value = old;
  updateSettings();
}
function updateSettings() {
  const dynamics = dynamicsSelected();
  $('rule-access-field').hidden = !dynamics;
  for (const id of ['attempts-field', 'budget-field', 'strategies-field']) $(id).hidden = dynamics;
  $('split-note').textContent = dynamics ? 'Dynamics currently has one public development task' : 'Both temporal splits are public, not a secret test set';
  if (dynamics) {
    $('attempts').value = '1';
    document.querySelectorAll('input[name="strategy"]').forEach(input => { input.checked = input.value === 'forward_only'; });
  }
  $('suite-note').textContent = dynamics ? 'Dynamics scores predictions only. This release permits one unassisted attempt; observing a resolved outcome and retrying it would not test an unseen future.' : 'Foundational temporal tasks use published rules. Optional recovery is scored separately; these tasks do not test learning unknown dynamics or predicting unseen futures.';
  $('validation-note').textContent = dynamics ? 'Four fixed dynamics conditions cross base/changed timing with inferred/provided rules. Uses seeds and model above; individual task, variant and mechanism controls are ignored. Maximum ten offline or three model seeds.' : 'Four fixed temporal conditions cross base/changed timestamps with clean/distracted observations. Uses seeds, model, strategies and budgets; individual task and variant controls are ignored. Maximum two attempts and ten offline or three model seeds.';
  const policy = state.config.policyKinds.find(p => p.id === $('policy').value);
  const offline = policy.id === 'reference';
  const limit = offline ? state.config.limits.referenceSeeds : state.config.limits.modelSeeds;
  $('seeds').max = limit;
  if (Number($('seeds').value) > limit) $('seeds').value = limit;
  $('seed-limit').textContent = `Up to ${limit} ${offline ? 'offline' : 'model'} seeds`;
  $('model-field').hidden = offline;
  $('model').disabled = offline;
  $('model').placeholder = policy.model || 'Use server model';
  $('policy-note').textContent = offline ? dynamics ? 'The offline reference learner infers the mechanism from public calibration evidence. Its scores verify the harness; they are not language-model results.' : 'Offline reference agents are deterministic fixtures, not language-model scores.' : `${policy.label}${policy.model ? ` · ${policy.model}` : ''}. Uses the configured server endpoint; hosted models can incur charges. Runs only when you select Run benchmark.`;
  $('settings-summary').textContent = `Seed ${$('seed').value} · ${$('seeds').value} seed${Number($('seeds').value) === 1 ? '' : 's'} · ${$('attempts').value} attempt${Number($('attempts').value) === 1 ? '' : 's'}`;
}
function readOptions() {
  const integer = (id, min, max) => {
    const raw = $(id).value, n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < min || n > max) throw new Error(`Choose ${$(id).labels[0].childNodes[0].textContent.trim().toLowerCase()} between ${min} and ${max}.`);
    return n;
  };
  const policyKind = $('policy').value;
  const strategies = [...document.querySelectorAll('input[name="strategy"]:checked')].map(c => c.value);
  if (!strategies.length) { $('settings-summary').closest('details').open = true; throw new Error('Select at least one strategy to run.'); }
  const dynamics = dynamicsSelected();
  const options = { suite: $('suite').value, policyKind, seed: integer('seed', 0, 2147483647), seedCount: integer('seeds', 1, Number($('seeds').max)), attempts: dynamics ? 1 : integer('attempts', 1, 5), analysisBudget: dynamics ? 0 : integer('budget', 0, 100), strategies: dynamics ? ['forward_only'] : strategies,
    split: $('split').value, variant: $('variant').value, interference: integer('interference', 0, 3) };
  if (dynamics) options.ruleAccess = $('rule-access').value;
  if (options.seed + options.seedCount - 1 > 2147483647) throw new Error('This seed range exceeds the maximum. Reduce the starting seed or number of seeds.');
  if ($('task').value) options.taskId = $('task').value;
  if (policyKind !== 'reference' && $('model').value.trim()) {
    const model = $('model').value.trim();
    if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) throw new Error('Enter a valid model identifier without spaces.');
    options.model = model;
  }
  return options;
}
function validationOptions() {
  const selected = readOptions();
  if (selected.split === 'all') throw new Error('Choose development or evaluation for matched validation. The fixed suite does not combine splits.');
  if (selected.attempts > 2) throw new Error('Matched validation supports at most two attempts per strategy.');
  if (selected.seedCount > (selected.policyKind === 'reference' ? 10 : 3)) throw new Error('Matched validation supports at most ten offline or three model seeds.');
  return Object.fromEntries(['suite', 'seed', 'seedCount', 'attempts', 'analysisBudget', 'policyKind', 'model', 'strategies', 'split'].filter(k => Object.hasOwn(selected, k)).map(k => [k, selected[k]]));
}
async function run(event, validation = false) {
  event.preventDefault();
  if (state.controller) return;
  $('error').hidden = true;
  let options;
  try { options = validation ? validationOptions() : readOptions(); }
  catch (error) { $('settings-summary').closest('details').open = true; showError(error.message); return; }
  state.controller = new AbortController();
  $('setup-fields').disabled = true; $('cancel').hidden = false; $('run').textContent = 'Running…'; $('import-report').disabled = true;
  const started = Date.now();
  const update = () => { $('run-status').textContent = `Running ${options.policyKind === 'reference' ? 'offline reference' : 'model'} ${validation ? 'validation · four fixed conditions' : 'benchmark'} · ${Math.floor((Date.now() - started) / 1000)}s. Results appear when the run completes.${state.report ? ' Previous report remains below.' : ''}`; };
  update();
  const timer = setInterval(update, 1000);
  try {
    const response = await fetch(validation ? '/api/validate' : '/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options), signal: state.controller.signal });
    const report = await response.json();
    if (!response.ok) throw new Error(report.error?.message ?? 'The benchmark request failed.');
    openReport(validateSavedReport(report));
    $('run-status').textContent = report.status === 'completed_with_errors' ? 'Completed with policy errors. Inspect error counts and partial attempts.' : `Complete · ${validation ? `${report.conditions.length} validation conditions` : `${report.cases.length} task/seed cases`}. No results are saved until you export JSON.`;
    $('results-title').focus({ preventScroll: true });
    $('results-title').scrollIntoView({ behavior: 'auto', block: 'start' });
  } catch (error) {
    if (error.name === 'AbortError') $('run-status').textContent = `Run cancelled.${state.report ? ' Previous report retained below.' : ''}`;
    else { showError(error.message); $('run-status').textContent = state.report ? 'The previous report is retained below.' : 'Run did not complete. Adjust the settings or try again.'; }
  } finally {
    clearInterval(timer); state.controller = null; $('setup-fields').disabled = false; $('cancel').hidden = true; $('cancel').disabled = false; $('import-report').disabled = false;
    $('run').innerHTML = 'Run benchmark <span aria-hidden="true">↗</span>'; updateSettings();
  }
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function openReport(report, imported = false) {
  state.document = report; state.imported = imported; state.conditionIndex = 0; state.caseIndex = 0;
  const validation = report.kind === 'temporal_validation';
  $('validation-summary').hidden = !validation;
  $('validation-summary').innerHTML = validation ? validationSummary(report) : '';
  $('condition-field').hidden = !validation;
  if (validation) $('condition-select').innerHTML = report.conditions.map((c, i) => option(i, `${c.id} · ${FAMILY_LABELS[c.family] ?? c.family}`)).join('');
  state.report = validation ? report.conditions[0].report : report;
  renderReport();
}
function renderReport() {
  const r = state.report, model = r.provenance.model;
  $('results').hidden = false; $('empty').hidden = true;
  const condition = state.document?.kind === 'temporal_validation' ? state.document.conditions[state.conditionIndex].id : null;
  $('report-context').textContent = `${condition ? `${condition} · ` : ''}${r.cases.length} task/seed cases · seeds ${r.options.seed}–${r.options.seed + r.options.seedCount - 1} · up to ${r.options.attempts} attempts · ${SPLIT_LABELS[r.options.split] ?? 'Legacy split'} · ${r.options.policyKind === 'reference' ? 'Offline reference' : model.model ?? r.options.policyKind}`;
  $('report-note').classList.toggle('error-note', r.status === 'completed_with_errors');
  const dynamics = r.options.suite === 'dynamics';
  const interpretation = dynamics ? `Prediction accuracy scores six fresh-run queries; the three calibration observations are unscored. Mechanism access: ${r.options.ruleAccess === 'given' ? 'provided-rule control' : 'inferred from observations'}. One unassisted attempt; no same-instance recovery.` : 'First pass measures unassisted success. Recovery counts only success after a failed completed first attempt; “—” means there were no eligible failures. Foundational/legacy results are separate from dynamics-learning predictions.';
  $('report-note').textContent = `${state.imported ? 'Imported local report; no new model run. ' : ''}${r.status === 'completed_with_errors' ? 'Completed with errors. Incomplete attempts have no score; there is no scripted fallback. ' : ''}${r.options.policyKind === 'reference' ? 'Deterministic reference results verify the harness, not model ability. ' : ''}${interpretation}${r.schemaVersion === 1 ? ' Automatic execution counts may not be recorded.' : ''}${condition ? ' This view shows one matched condition; Export JSON retains the complete validation suite.' : ''}`;
  const families = [...new Set(r.cases.map(c => c.family))];
  $('score-table').innerHTML = `<label class="score-filter">Results for<select id="score-family">${option('all', 'All families') + families.map(f => option(f, FAMILY_LABELS[f])).join('')}</select></label><div id="score-content"></div>`;
  $('score-content').innerHTML = scoreTable(r);
  $('score-family').addEventListener('change', () => { $('score-content').innerHTML = scoreTable(r, $('score-family').value); });
  $('costs').innerHTML = costCards(r);
  $('case-select').innerHTML = r.cases.map((c, i) => option(i, `${taskName(c.taskId)} · seed ${c.seed}`)).join('');
  $('protocol-detail').innerHTML = `<p>Report ${e(r.benchmarkVersion)} · schema ${r.schemaVersion} · ${e(r.provenance.runtime)} / ${e(r.provenance.platform)}</p><p>Source hash: <code>${e(r.provenance.sourceHash)}</code><br>Recorded report hash: <code>${e(r.reportHash)}</code></p><ul>${r.limitations.map(l => `<li>${e(l)}</li>`).join('')}</ul><details><summary>Recorded configuration and protocol${condition ? ', matched comparisons and suite costs' : ''}</summary><pre>${e(JSON.stringify({ options: r.options, protocol: r.protocol, provenance: r.provenance, ...(condition ? { validation: { pairs: state.document.pairs, summary: state.document.summary, costs: state.document.costs, limitations: state.document.limitations, reportHash: state.document.reportHash } } : {}) }, null, 2))}</pre></details>`;
  renderCase();
}
function renderCase() {
  const item = currentCase();
  $('task-brief').innerHTML = taskBriefDetails(item.brief);
  $('strategy-select').innerHTML = item.runs.map(r => option(r.strategy, strategyName(r.strategy))).join('');
  if (!item.runs.some(r => r.strategy === state.strategy)) state.strategy = item.runs[0].strategy;
  $('strategy-select').value = state.strategy;
  renderRun();
}
function renderRun() {
  const run = currentRun();
  state.attemptIndex = run.attempts.length - 1;
  $('attempt-select').innerHTML = run.attempts.map((a, i) => option(i, `Attempt ${a.index}${i === 0 ? ' · unassisted' : ' · retry'} · ${a.status === 'error' ? 'error' : a.success ? 'passed' : 'unsuccessful'}`)).join('');
  $('attempt-select').value = state.attemptIndex;
  renderAttempt();
}
function renderAttempt() {
  const run = currentRun(), attempt = currentAttempt();
  state.stepIndex = 0;
  const status = attempt.status === 'error' ? 'POLICY ERROR' : attempt.success ? 'PASSED' : 'UNSUCCESSFUL';
  const execution = Number.isFinite(attempt.automaticActions) && Number.isFinite(attempt.policyDecisions) ? `${number(attempt.policyDecisions)} policy choices · ${number(attempt.automaticActions)} automatic actions` : 'Execution counts not recorded';
  $('attempt-outcome').innerHTML = `<div class="outcome"><span class="pill ${attempt.success ? 'good' : 'bad'}">${status}</span><span>${state.report.options.suite === 'dynamics' ? 'Prediction accuracy' : 'Score'}: ${attempt.score === null ? 'not scored' : percent(attempt.score)}</span><span>${attempt.steps.length} forward actions · ${number(attempt.effort)} effort</span><span>${execution}</span><span>${attempt.modelUsage ? `${number(attempt.modelUsage.calls)} model calls` : state.report.options.policyKind === 'reference' ? 'Offline reference' : 'Model usage unreported'}</span></div>${attempt.error ? `<p class="error">${e(attempt.error.code)}: ${e(attempt.error.message)}</p>` : ''}${run.analyses.some(a => a.error) ? '<p class="error">This strategy stopped because an analyst failed. The last completed attempt is shown. See replay evidence for the error code.</p>' : ''}`;
  $('timeline').innerHTML = attempt.steps.map((s, i) => `<button type="button" class="checkpoint${s.injectedHints?.length ? ' has-note' : ''}${s.actions.length > 1 ? ' query' : ''}" data-step="${i}" aria-label="Checkpoint ${s.t}: ${e(s.checkpointId.replaceAll('_', ' '))}" aria-pressed="${i === 0}">${String(s.t).padStart(2, '0')}</button>`).join('');
  $('timeline').style.setProperty('--checkpoint-count', Math.max(attempt.steps.length, 1));
  $('gate-checks').innerHTML = gateChecks(attempt);
  $('analysis-detail').innerHTML = state.report.options.suite === 'dynamics' ? '' : analysisDetails(run, attempt);
  renderStep();
}
function renderStep() {
  $('timeline').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.stepIndex)));
  $('step-detail').innerHTML = stepDetail(currentAttempt().steps[state.stepIndex]);
}
function exportReport() {
  if (!state.document) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.document, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `results-turnstile-${state.document.reportHash.slice(0, 12)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importReport() {
  const file = $('import-report').files?.[0];
  if (!file || state.controller) return;
  $('error').hidden = true;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a report smaller than 25 MB. Large reports remain available through the CLI.');
    let value;
    try { value = JSON.parse(await file.text()); } catch { throw new Error('This file does not contain readable JSON.'); }
    openReport(validateSavedReport(value), true);
    $('run-status').textContent = `Opened ${file.name} locally. No data was uploaded and no model was called.`;
    $('results-title').focus({ preventScroll: true }); $('results-title').scrollIntoView({ block: 'start' });
  } catch (error) { showError(error.message); }
  finally { $('import-report').value = ''; }
}
async function init() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('The server configuration could not be loaded.');
    state.config = (await response.json()).benchmark;
    if (!state.config?.policyKinds || !state.config.limits) throw new Error('Restart the local server to load the benchmark workbench update.');
    $('policy').innerHTML = state.config.policyKinds.map(p => option(p.id, `${p.label}${p.available ? '' : ' · not configured'}`, !p.available)).join('');
    $('policy').value = 'reference';
    $('strategy-options').innerHTML = state.config.strategies.map(s => `<label class="check-option"><input type="checkbox" name="strategy" value="${e(s.id)}"${s.id === 'forward_only' ? ' checked' : ''}><span>${e(STRATEGY_LABELS[s.id])}<small>${e(STRATEGY_DESCRIPTIONS[s.id])}</small></span></label>`).join('');
    $('setup-fields').disabled = false; updateTasks();
    $('run-status').textContent = 'Ready. Reference runs stay offline; model agents use server configuration.';
  } catch (error) { showError(error.message); $('run-status').textContent = 'Start or restart the local server, then reload this page.'; }
}
$('benchmark-form').addEventListener('submit', run);
$('suite').addEventListener('change', updateTasks);
$('split').addEventListener('change', updateTasks);
for (const id of ['task', 'policy', 'seed', 'seeds', 'attempts']) $(id).addEventListener('change', updateSettings);
$('cancel').addEventListener('click', () => { $('cancel').disabled = true; state.controller?.abort(); });
$('case-select').addEventListener('change', () => { state.caseIndex = Number($('case-select').value); renderCase(); });
$('strategy-select').addEventListener('change', () => { state.strategy = $('strategy-select').value; renderRun(); });
$('attempt-select').addEventListener('change', () => { state.attemptIndex = Number($('attempt-select').value); renderAttempt(); });
$('timeline').addEventListener('click', event => { const b = event.target.closest('button[data-step]'); if (b) { state.stepIndex = Number(b.dataset.step); renderStep(); } });
$('export').addEventListener('click', exportReport);
$('validate').addEventListener('click', event => run(event, true));
$('import-report').addEventListener('change', importReport);
$('condition-select').addEventListener('change', () => { state.conditionIndex = Number($('condition-select').value); state.report = state.document.conditions[state.conditionIndex].report; state.caseIndex = 0; renderReport(); });
init();
