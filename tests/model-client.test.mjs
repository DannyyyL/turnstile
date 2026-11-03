import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelClient, createModelPolicy, ModelError } from '../model.mjs';
import { runBenchmark } from '../benchmark/index.mjs';

const context = { actions: [{ id: 'record' }] };
const result = (value, extras = {}) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], ...extras }) });

test('compatible transport supports authenticated hosted and keyless local endpoints', async () => {
  for (const [baseURL, apiKey] of [['https://models.example.test/v1', 'private-test-key'], ['http://127.0.0.1:1234/v1', '']]) {
    const calls = [];
    const policy = createModelPolicy({ provider: 'compatible', model: 'local/model:quant', baseURL, apiKey, fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return result({ actionId: 'record', reasoning: 'Record the event.' }, { usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } });
    } });
    assert.equal((await policy.decide(context)).actionId, 'record');
    assert.equal(calls[0].url, `${baseURL}/chat/completions`);
    assert.equal(calls[0].options.headers.Authorization, apiKey ? `Bearer ${apiKey}` : undefined);
    assert.equal(calls[0].options.redirect, 'error');
    assert.deepEqual(calls[0].body.response_format.json_schema.schema.properties.actionId.enum, ['record']);
    assert.equal(policy.usage().totalTokens, 12);
    assert.equal(policy.usage().unreportedUsageCalls, 0);
    assert.ok(!JSON.stringify(policy.usage()).includes('private-test-key'));
    assert.ok(!JSON.stringify(policy.usage()).includes(baseURL));
  }
});

test('JSON and text compatibility are explicit and still validate outputs locally', async () => {
  for (const format of ['json_object', 'text']) {
    let body;
    const policy = createModelPolicy({ provider: 'compatible', model: 'test', baseURL: 'http://localhost:1234/v1', apiKey: '', format, fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body); return result({ actionId: 'record', reasoning: 'ok' });
    } });
    await policy.decide(context);
    assert.deepEqual(body.response_format, format === 'text' ? undefined : { type: 'json_object' });
    assert.ok(body.messages[0].content.includes('JSON object'));
    assert.equal(policy.usage().unreportedUsageCalls, 1);
  }
  const invalid = createModelPolicy({ provider: 'compatible', model: 'test', baseURL: 'http://localhost:1234/v1', apiKey: '', format: 'text', fetchImpl: async () => result({ actionId: 'record', reasoning: 'ok', hiddenExtra: 'invalid' }) });
  await assert.rejects(() => invalid.decide(context), error => error.code === 'MODEL_STRUCTURE');
});

test('adapter validates custom clients and forwards equal analyst evidence in opposite order', async () => {
  const requests = [];
  const client = { usage: () => ({ provider: 'custom', model: 'native-runtime' }), async complete(request) {
    requests.push(request); return { summary: 'No supported change.', recommendations: [] };
  } };
  const policy = createModelPolicy({ client });
  const evidence = { trajectory: [{ t: 1 }, { t: 14 }], budget: { maxReplays: 4 } };
  await policy.reflect(evidence); await policy.invert(evidence);
  assert.deepEqual(requests[0].context.trajectory, [{ t: 1 }, { t: 14 }]);
  assert.deepEqual(requests[1].context.trajectory, [{ t: 14 }, { t: 1 }]);
  assert.deepEqual(requests[0].schema, requests[1].schema);
  assert.deepEqual(requests[0].context.budget, requests[1].context.budget);
  const malformed = createModelPolicy({ client: { usage: () => ({}), complete: async () => null } });
  await assert.rejects(() => malformed.decide(context), error => error.code === 'MODEL_STRUCTURE');
});

test('limits, cancellation, refusals and provider errors never retry or silently fall back', async () => {
  let calls = 0;
  const options = { provider: 'compatible', model: 'test', baseURL: 'http://127.0.0.1:1234/v1', apiKey: '' };
  const policy = createModelPolicy({ ...options, maxCalls: 1, fetchImpl: async () => { calls++; return result({ actionId: 'record', reasoning: 'ok' }); } });
  await policy.decide(context);
  await assert.rejects(() => policy.decide(context), error => error.code === 'MODEL_CALL_LIMIT');
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  const cancelled = createModelPolicy({ ...options, signal: controller.signal, fetchImpl: () => assert.fail('Must not call provider') });
  await assert.rejects(() => cancelled.decide(context), error => error.code === 'CANCELLED');
  for (const [response, code] of [
    [{ ok: false, status: 429, text: () => 'private server details' }, 'MODEL_HTTP_429'],
    [{ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }, 'MODEL_INCOMPLETE'],
    [{ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { refusal: 'refused' } }] }) }, 'MODEL_REFUSAL'],
    [result('not an object'), 'MODEL_STRUCTURE'],
    [{ ok: true, json: async () => { throw new Error('private content'); } }, 'MODEL_RESPONSE'],
  ]) {
    const broken = createModelPolicy({ ...options, fetchImpl: async () => response });
    await assert.rejects(() => broken.decide(context), error => error instanceof ModelError && error.code === code && !error.message.includes('private'));
  }
  for (const baseURL of ['http://external.example.test/v1', 'https://user:password@example.test/v1', 'https://example.test/v1?key=secret']) assert.throws(() => createModelClient({ ...options, baseURL }), /HTTPS/);
});

test('one benchmark counts shared model calls once and preserves call-limit errors in JSON', async () => {
  const client = createModelClient({ provider: 'compatible', model: 'mock-model', baseURL: 'http://127.0.0.1:1234/v1', apiKey: '', maxCalls: 5, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), c = JSON.parse(body.messages[1].content);
    const cheapest = [...c.actions].sort((a, b) => a.cost - b.cost)[0];
    return result({ actionId: cheapest.id, reasoning: 'Offline transport fixture.' }, { usage: { prompt_tokens: 2, completion_tokens: 1 } });
  } });
  const report = await runBenchmark({ taskId: 'temporal_release', policyKind: 'compatible', strategies: ['forward_only'] }, { policy: createModelPolicy({ client }) });
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(report.costs.modelUsage.calls, 5);
  assert.equal(report.costs.modelUsage.totalTokens, 15);
  assert.equal(report.cases[0].runs[0].attempts[1].error.code, 'MODEL_CALL_LIMIT');
  assert.equal(report.cases[0].runs[0].attempts[0].modelUsage.calls, 4);
});

test('reused clients report operation usage without counting earlier calls again', async () => {
  const policy = createModelPolicy({ provider: 'compatible', model: 'test', baseURL: 'http://127.0.0.1:1234/v1', apiKey: '', fetchImpl: async (_url, options) => {
    const c = JSON.parse(JSON.parse(options.body).messages[1].content);
    return result({ actionId: c.actions[0].id, reasoning: 'Fixture.' }, { usage: { prompt_tokens: 2, completion_tokens: 1 } });
  } });
  const options = { taskId: 'state_ledger', attempts: 1, strategies: ['forward_only'] };
  const a = await runBenchmark(options, { policy });
  const b = await runBenchmark(options, { policy });
  assert.equal(a.options.policyKind, 'compatible');
  assert.equal(a.costs.modelUsage.calls, 3); assert.equal(b.costs.modelUsage.calls, 3);
  assert.equal(b.costs.modelUsage.totalTokens, 9); assert.equal(policy.usage().calls, 6);
});
