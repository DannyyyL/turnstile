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
  assert.deepEqual(parseArgs(['compare', '--seed', '42', '--attempts', '2', '--seeds', '10', '--output', 'result.json']), {
    operation: 'benchmark', options: { seed: 42, attempts: 2, seedCount: 10 }, output: 'result.json',
  });
  assert.throws(() => parseArgs(['run', '--seeds', '2']), /--seeds/);
  assert.throws(() => parseArgs(['compare', '--seed', '42', '--seed', '43']), /more than once/);
  assert.throws(() => parseArgs(['compare', '--policy']), /requires a value/);
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
  assert.ok(!Object.hasOwn(settings, 'apiKey'));
  assert.ok(config().scenarios.length > 0);
  const source = await fetch(`${base}/model.mjs`);
  assert.equal(source.status, 404);
  const foreign = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(foreign.status, 403);
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
});
