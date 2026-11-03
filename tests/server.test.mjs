import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, config, validateOptions, publicError, aggregateComparisons } from '../server.mjs';
import { createModelPolicy, ModelError } from '../model.mjs';
import { parseArgs } from '../cli.mjs';

const mockResult = (value, usage = {}) => ({
  ok: true, json: async () => ({ status: 'completed', usage, output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] }),
});

test('browser benchmark metadata exposes safe models, configuration status and limits', (t) => {
  const keys = ['OPENAI_API_KEY', 'TURNSTILE_BASE_URL', 'TURNSTILE_MODEL', 'TURNSTILE_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  for (const key of keys) delete process.env[key];
  const empty = config().benchmark;
  assert.deepEqual(empty.policyKinds.map(policy => [policy.id, policy.available]), [['reference', true], ['openai', false], ['compatible', false]]);
  assert.deepEqual(empty.tasks.map(task => task.id), ['delayed_commit', 'temporal_history', 'temporal_revision']);
  assert.equal(empty.legacyTasks.length, 6);
  assert.equal(empty.strategies.length, 4);
  assert.equal(empty.version, '0.5.0');
  assert.equal(empty.schemaVersion, 4);
  assert.deepEqual(empty.suites, ['dynamics', 'temporal', 'legacy']);
  assert.equal(empty.defaultSuite, 'dynamics');
  assert.deepEqual(empty.ruleAccessModes, ['infer', 'given']);
  assert.deepEqual(empty.variants, ['base', 'temporal_shift']);
  assert.deepEqual(empty.limits, { attempts: 5, referenceSeeds: 50, modelSeeds: 3, delay: 7, analysisBudget: 100, interference: 3 });
  assert.equal(empty.automaticSingletonActions, true);
  assert.deepEqual(empty.splits, ['development', 'evaluation', 'all']);
  process.env.OPENAI_API_KEY = 'private-openai-key';
  process.env.TURNSTILE_BASE_URL = 'https://private-endpoint.example/v1';
  process.env.TURNSTILE_MODEL = 'local/model:quant';
  process.env.TURNSTILE_API_KEY = 'private-compatible-key';
  const configured = config().benchmark;
  assert.ok(configured.policyKinds.every(policy => policy.available));
  assert.equal(configured.policyKinds.find(policy => policy.id === 'compatible').model, 'local/model:quant');
  const serialized = JSON.stringify(config());
  for (const privateValue of ['private-openai-key', 'private-compatible-key', 'private-endpoint.example']) assert.ok(!serialized.includes(privateValue));
  process.env.TURNSTILE_MODEL = 'https://private-endpoint.example/v1';
  assert.equal(config().benchmark.policyKinds.find(policy => policy.id === 'compatible').model, null);
});

test('browser benchmark requests validate task families, strategy selection and model seed limits', () => {
  const defaults = validateOptions({}, 'evaluate');
  assert.equal(defaults.suite, 'dynamics');
  assert.equal(defaults.variant, 'base');
  assert.equal(defaults.attempts, 1);
  assert.deepEqual(defaults.strategies, ['forward_only']);
  const selected = validateOptions({ suite: 'temporal', family: 'temporal_state_tracking', strategies: ['trace_memory', 'temporal_pincer'], variant: 'temporal_shift' }, 'evaluate');
  assert.deepEqual(selected.strategies, ['trace_memory', 'temporal_pincer']);
  assert.equal(selected.variant, 'temporal_shift');
  assert.equal(selected.policyKind, 'reference');
  const legacy = validateOptions({ taskId: 'state_ledger' }, 'evaluate');
  assert.equal(legacy.suite, 'legacy');
  assert.equal(legacy.attempts, 2);
  assert.equal(legacy.strategies.length, 4);
  assert.equal(validateOptions({ suite: 'legacy', family: 'delayed_consequences', delay: 0 }, 'evaluate').delay, 0);
  for (const invalid of [{ taskId: 'missing' }, { family: 'missing' }, { suite: 'missing' }, { variant: 'missing' }, { suite: 'temporal', taskId: 'state_ledger' }, { suite: 'legacy', variant: 'temporal_shift' }, { family: 'delayed_consequences' }, { strategies: [] }, { strategies: ['reflection', 'reflection'] }, { policyKind: 'compatible', seedCount: 4 }, { delay: 8 }, { apiKey: 'private' }]) assert.throws(() => validateOptions(invalid, 'evaluate'));
});

test('input limits reject cost surprises and invalid experiment choices', () => {
  assert.equal(validateOptions({}, 'run').mode, 'temporal_pincer');
  assert.equal(validateOptions({ mode: 'pincer' }, 'run').mode, 'temporal_pincer');
  assert.throws(() => validateOptions({ attempts: 6 }), /attempts/);
  assert.throws(() => validateOptions({ seed: '42' }), /seed/);
  assert.throws(() => validateOptions({ scenarioId: 'unknown' }), /scenario/);
  assert.throws(() => validateOptions({ apiKey: 'never accept browser credentials' }), /Unknown/);
  assert.throws(() => validateOptions({ policyKind: 'openai', seedCount: 4 }, 'benchmark'), /seedCount/);
  assert.equal(validateOptions({ policyKind: 'openai' }, 'benchmark').seedCount, 1);
  assert.throws(() => validateOptions({ seed: 2147483647, seedCount: 2 }, 'benchmark'), /range/);
});

test('CLI translates paired batch options without silently dropping invalid flags', () => {
  assert.deepEqual(parseArgs([]), { operation: 'evaluate', options: {}, output: undefined });
  assert.deepEqual(parseArgs(['compare', '--seed', '42', '--attempts', '2', '--seeds', '10', '--output', 'result.json']), {
    operation: 'benchmark', options: { seed: 42, attempts: 2, seedCount: 10 }, output: 'result.json',
  });
  assert.throws(() => parseArgs(['run', '--seeds', '2']), /--seeds/);
  assert.throws(() => parseArgs(['compare', '--seed', '42', '--seed', '43']), /more than once/);
  assert.throws(() => parseArgs(['compare', '--policy']), /requires a value/);
  assert.deepEqual(parseArgs(['validate', '--split', 'evaluation', '--seeds', '2']).options, { split: 'evaluation', seedCount: 2 });
  assert.deepEqual(parseArgs(['evaluate', '--suite', 'temporal', '--variant', 'temporal_shift']).options, { suite: 'temporal', variant: 'temporal_shift' });
  assert.deepEqual(parseArgs(['validate', '--suite', 'legacy']).options, { suite: 'legacy' });
  assert.throws(() => validateOptions({ taskId: 'state_ledger' }, 'validate'), /Unknown validation option/);
});

test('model adapter uses only available actions and parses output beyond reasoning items', async () => {
  let payload;
  const policy = createModelPolicy({ apiKey: 'test-secret-key', model: 'test-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    payload = JSON.parse(options.body);
    return mockResult({ actionId: 'persist', reasoning: 'Restart evidence favors durable work.' }, { input_tokens: 12, output_tokens: 8, total_tokens: 20 });
  } });
  assert.equal((await policy.decide({ actions: [{ id: 'persist', label: 'Persist' }] })).actionId, 'persist');
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.strict, true);
  assert.deepEqual(payload.text.format.schema.properties.actionId.enum, ['persist']);
  assert.equal(policy.usage().calls, 1);
  assert.equal(policy.usage().totalTokens, 20);
  assert.ok(!JSON.stringify(policy.usage()).includes('test-secret-key'));
});

test('both model analysts receive the same trace with equal output limits and explicit opposite order', async () => {
  const calls = [];
  const policy = createModelPolicy({ apiKey: 'test-key', fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return mockResult({ summary: 'No supported repair.', recommendations: [] });
  } });
  const trajectory = [{ t: 1, observation: 'Chosen action' }, { t: 15, observation: 'Delayed failure' }];
  const context = { trajectory, outcome: { success: false } };
  await policy.reflect(context);
  await policy.invert(context);
  assert.deepEqual(JSON.parse(calls[0].input[0].content).trajectory.map(step => step.t), [1, 15]);
  assert.deepEqual(JSON.parse(calls[1].input[0].content).trajectory.map(step => step.t), [15, 1]);
  assert.equal(calls[0].max_output_tokens, calls[1].max_output_tokens);
  assert.deepEqual(calls[0].text.format.schema, calls[1].text.format.schema);
  assert.deepEqual(trajectory.map(step => step.t), [1, 15]);
});

test('model errors never turn into scripted fallback or leak provider error contents', async () => {
  const context = { actions: [{ id: 'persist' }] };
  const rejected = createModelPolicy({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'private-key-and-context' }) }) });
  await assert.rejects(() => rejected.decide(context), error => error instanceof ModelError && !error.message.includes('private'));
  const wrong = createModelPolicy({ apiKey: 'test-key', fetchImpl: async () => mockResult({ actionId: 'hidden-action', reasoning: 'Unsupported' }) });
  await assert.rejects(() => wrong.decide(context), /invalid action/);
  const incomplete = createModelPolicy({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) }) });
  await assert.rejects(() => incomplete.decide(context), /incomplete/);
  assert.ok(!JSON.stringify(publicError(new Error('secret-value'))).includes('secret-value'));
});

test('benchmark aggregates actual execution and replay effort separately', () => {
  const summary = aggregateComparisons([{ runs: [{ mode: 'reflection', attempts: [{ index: 1 }, { index: 2 }], metrics: {
    success: true, actions: 56, executionActions: 32, replayActions: 24, cost: 102, executionCost: 70, replayCost: 32,
  } }] }]);
  assert.equal(summary[0].successRate, 1);
  assert.equal(summary[0].averageActions, 56);
  assert.equal(summary[0].totalReplayActions, 24);
  assert.equal(summary[0].totalAttempts, 2);
});

test('localhost API rejects foreign origins, oversized bodies and server-source reads', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = await (await fetch(`${base}/api/config`)).json();
  assert.equal(settings.name, 'Turnstile');
  assert.equal(settings.benchmark.endpoint, '/api/evaluate');
  assert.equal(settings.benchmark.policyKinds.length, 3);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /href="\/workbench\.html"/);
  const workbench = await fetch(`${base}/workbench.html`);
  assert.equal(workbench.status, 200);
  assert.match(await workbench.text(), /id="benchmark-form"/);
  const pilotScores = await fetch(`${base}/pilot-scores.json`);
  assert.equal(pilotScores.status, 200);
  assert.match(pilotScores.headers.get('content-type'), /application\/json/);
  const { models } = await pilotScores.json();
  assert.ok(models.length >= 10);
  assert.equal(new Set(models.map(model => model.modelId)).size, models.length);
  assert.ok(models.every(model => model.forecastsTotal === 24 && model.pairedTotal === 11
    && Number.isInteger(model.forecastsCorrect) && model.forecastsCorrect >= 0 && model.forecastsCorrect <= model.forecastsTotal
    && Number.isInteger(model.pairedCorrect) && model.pairedCorrect >= 0 && model.pairedCorrect <= model.pairedTotal));
  const demo = await fetch(`${base}/demo.html`);
  assert.equal(demo.status, 200);
  assert.match(await demo.text(), /id="run-button"/);
  for (const asset of ['landing.js', 'landing.css', 'benchmark-app.js', 'benchmark-view.js', 'benchmark.css']) {
    const response = await fetch(`${base}/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /text\/javascript/);
  }
  assert.ok(!Object.hasOwn(settings, 'apiKey'));
  assert.ok(config().scenarios.length > 0);
  const source = await fetch(`${base}/model.mjs`);
  assert.equal(source.status, 404);
  const foreign = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const foreignBenchmark = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(foreignBenchmark.status, 403);
  const malformed = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(17000) }) });
  assert.equal(oversized.status, 413);
  const valid = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: 'webhook_release', seed: 42, attempts: 2, policyKind: 'reference' }) });
  assert.equal(valid.status, 200);
  const comparison = await valid.json();
  assert.equal(comparison.runs.length, 3);
  assert.equal(comparison.comparisonProtocol.sharedFirstAttempt, true);
  assert.deepEqual(comparison.runs.map(run => run.metrics.success), [false, true, true]);
  const core = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(core.status, 200);
  const coreReport = await core.json();
  assert.equal(coreReport.schemaVersion, 4);
  assert.equal(coreReport.benchmarkVersion, '0.5.0');
  assert.equal(coreReport.options.suite, 'dynamics');
  assert.equal(coreReport.options.attempts, 1);
  assert.deepEqual(coreReport.options.strategies, ['forward_only']);
  assert.deepEqual(coreReport.cases.map(item => item.taskId), ['delayed_commit']);
  assert.equal(coreReport.cases[0].runs[0].attempts.length, 1);
  assert.equal(coreReport.costs.physicalPolicyDecisions, 6);
  assert.equal(coreReport.costs.physicalAutomaticActions, 3);
  assert.equal(coreReport.cases[0].runs[0].metrics.firstAttemptScore, 1);
  const shifted = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suite: 'temporal', variant: 'temporal_shift', split: 'all' }) });
  assert.equal(shifted.status, 200);
  const shiftedReport = await shifted.json();
  assert.equal(shiftedReport.options.variant, 'temporal_shift');
  assert.deepEqual(shiftedReport.cases.map(item => item.taskId), ['temporal_history', 'temporal_revision']);
  const benchmark = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'state_access', attempts: 1 }) });
  assert.equal(benchmark.status, 200);
  const report = await benchmark.json();
  assert.equal(report.kind, 'temporal_benchmark');
  assert.equal(report.options.suite, 'legacy');
  assert.equal(report.cases[0].runs.length, 4);
  assert.equal(report.costs.physicalForwardActions, 14);
  const delayed = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suite: 'legacy', family: 'delayed_consequences', strategies: ['reflection', 'temporal_pincer'], attempts: 2, delay: 0 }) });
  assert.equal(delayed.status, 200);
  const delayedReport = await delayed.json();
  assert.equal(delayedReport.status, 'completed');
  assert.equal(delayedReport.cases.length, 2);
  assert.ok(delayedReport.cases.every(item => item.family === 'delayed_consequences' && item.runs.length === 2));
  assert.equal(delayedReport.costs.modelUsage, null);
  const validation = await fetch(`${base}/api/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seedCount: 1, attempts: 1 }) });
  assert.equal(validation.status, 200);
  const controls = await validation.json();
  assert.equal(controls.kind, 'temporal_validation');
  assert.equal(controls.schemaVersion, 3);
  assert.equal(controls.options.suite, 'dynamics');
  assert.equal(controls.conditions.length, 4);
  assert.equal(controls.status, 'completed');
  assert.equal(controls.costs.physicalPolicyDecisions, 24);
  const legacyValidation = await fetch(`${base}/api/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suite: 'legacy', seedCount: 1, attempts: 1, strategies: ['forward_only'] }) });
  assert.equal(legacyValidation.status, 200);
  const legacyControls = await legacyValidation.json();
  assert.equal(legacyControls.conditions.length, 8);
  assert.equal(legacyControls.status, 'completed');
  assert.equal(legacyControls.costs.physicalPolicyDecisions, 28);
  for (const file of ['model-client.mjs', 'benchmark/tasks.mjs', 'benchmark/index.mjs']) assert.equal((await fetch(`${base}/${file}`)).status, 404);
  const untrustedEndpoint = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseURL: 'http://untrusted.example/v1' }) });
  assert.equal(untrustedEndpoint.status, 400);
  assert.throws(() => validateOptions({ policyKind: 'custom' }, 'evaluate'), /JavaScript/);
});
