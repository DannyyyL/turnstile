/** Server-only transport. Adapters return JSON objects; no provider state is reused. */
import { createHash } from 'node:crypto';
export class ModelError extends Error {
  constructor(message, code = 'MODEL_ERROR') { super(message); this.name = 'ModelError'; this.code = code; }
}

export const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// Validate locally even when a server claims to enforce structured output.
export function validateStructured(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required.some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(schema.properties).every(([key, child]) => !Object.hasOwn(value, key) || validateStructured(value[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => validateStructured(item, schema.items));
  if (schema.type === 'integer') return Number.isInteger(value);
  if (schema.type === 'string') return typeof value === 'string' && (!schema.enum || schema.enum.includes(value));
  return false;
}

export function createModelClient({
  provider = 'openai', model, baseURL, apiKey, format = 'json_schema',
  fetchImpl = globalThis.fetch, signal, maxCalls = 300, maxOutputTokens = 1200, timeoutMs = 45000,
} = {}) {
  if (!['openai', 'compatible'].includes(provider)) throw new ModelError('Unknown model provider.', 'MODEL_CONFIG');
  model ??= provider === 'openai' ? process.env.OPENAI_MODEL || 'gpt-4.1-mini' : process.env.TURNSTILE_MODEL;
  apiKey ??= provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.TURNSTILE_API_KEY;
  baseURL ??= provider === 'openai' ? 'https://api.openai.com/v1' : process.env.TURNSTILE_BASE_URL;
  if (provider === 'openai' && !apiKey) throw new ModelError('Live model mode requires OPENAI_API_KEY on the server.', 'MODEL_NOT_CONFIGURED');
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) throw new ModelError('Choose a valid model name.', 'INVALID_MODEL');
  let endpoint;
  try {
    const url = new URL(baseURL);
    if (url.username || url.password || url.search || url.hash) throw new Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
    endpoint = `${url.href.replace(/\/$/, '')}/${provider === 'openai' ? 'responses' : 'chat/completions'}`;
  } catch { throw new ModelError('Configure an HTTPS provider URL or an HTTP loopback model server.', 'MODEL_CONFIG'); }
  if (!['json_schema', 'json_object', 'text'].includes(format)) throw new ModelError('Unknown output format.', 'MODEL_CONFIG');
  if (provider === 'openai' && format !== 'json_schema') throw new ModelError('The Responses adapter requires json_schema.', 'MODEL_CONFIG');
  for (const [name, value, maximum] of [['maxCalls', maxCalls, 10000], ['maxOutputTokens', maxOutputTokens, 32768], ['timeoutMs', timeoutMs, 300000]]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ModelError(`Invalid ${name}.`, 'MODEL_CONFIG');
  }
  const counters = { provider, model, format, endpointHash: createHash('sha256').update(endpoint).digest('hex'), sampling: 'provider defaults', timeoutMs,
    calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, unreportedUsageCalls: 0, maxCalls, maxOutputTokens };
  return {
    usage: () => ({ ...counters }),
    async complete({ kind, context, schema, instructions }) {
      if (signal?.aborted) throw new ModelError('The experiment was cancelled.', 'CANCELLED');
      if (counters.calls >= maxCalls) throw new ModelError('The experiment reached its model-call limit.', 'MODEL_CALL_LIMIT');
      const prompt = `${instructions} Return only a JSON object matching this schema: ${JSON.stringify(schema)}`;
      const payload = provider === 'openai' ? {
        model, store: false, max_output_tokens: maxOutputTokens, instructions: prompt,
        input: [{ role: 'user', content: JSON.stringify(context) }],
        text: { format: { type: 'json_schema', name: `turnstile_${kind}`, strict: true, schema } },
      } : {
        model, max_tokens: maxOutputTokens,
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(context) }],
        ...(format === 'text' ? {} : { response_format: format === 'json_object' ? { type: 'json_object' }
          : { type: 'json_schema', json_schema: { name: `turnstile_${kind}`, strict: true, schema } } }),
      };
      counters.calls++;
      let response, result;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(payload),
        });
      } catch { throw new ModelError(signal?.aborted ? 'The experiment was cancelled.' : 'The model request failed or timed out. Check network access.', signal?.aborted ? 'CANCELLED' : 'MODEL_CONNECTION'); }
      if (!response.ok) throw new ModelError('The model provider rejected the request. Check credentials, model access, output format and spending limits.', `MODEL_HTTP_${response.status}`);
      try { result = await response.json(); }
      catch { throw new ModelError('The model provider returned an unreadable response.', 'MODEL_RESPONSE'); }
      const usage = result?.usage;
      const input = usage?.input_tokens ?? usage?.prompt_tokens;
      const output = usage?.output_tokens ?? usage?.completion_tokens;
      if (![input, output].every(n => Number.isFinite(n) && n >= 0)) counters.unreportedUsageCalls++;
      else { counters.inputTokens += input; counters.outputTokens += output; counters.totalTokens += input + output; }
      let raw;
      if (provider === 'openai') {
        if (result?.status && result.status !== 'completed') throw new ModelError('The model response was incomplete.', 'MODEL_INCOMPLETE');
        const content = (Array.isArray(result?.output) ? result.output : []).flatMap(item => item.content || []);
        if (content.some(item => item.type === 'refusal')) throw new ModelError('The model declined this request.', 'MODEL_REFUSAL');
        raw = content.filter(item => item.type === 'output_text').map(item => item.text).join('');
      } else {
        const choice = result?.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new ModelError('The model declined this request.', 'MODEL_REFUSAL');
        if (choice?.finish_reason !== 'stop') throw new ModelError('The model response was incomplete.', 'MODEL_INCOMPLETE');
        raw = choice?.message?.content;
      }
      let value;
      try { value = JSON.parse(raw); }
      catch { throw new ModelError('The model did not return the required structured result.', 'MODEL_STRUCTURE'); }
      if (!validateStructured(value, schema)) throw new ModelError('The model returned invalid action or analysis structure.', 'MODEL_STRUCTURE');
      return value;
    },
  };
}
