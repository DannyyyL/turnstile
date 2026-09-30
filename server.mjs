import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as engine from './engine/index.js';
import { createModelPolicy, DEFAULT_MODEL, ModelError } from './model.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;
const MODE_ALIASES = { forward: 'forward_only', pincer: 'temporal_pincer' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export class InputError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}

export function config() {
  return {
    name: 'Turnstile', version: '0.1.0', scenarios: engine.SCENARIOS, modes: engine.MODES,
    modelAvailable: Boolean(process.env.OPENAI_API_KEY), model: DEFAULT_MODEL,
    policyKinds: [
      { id: 'reference', label: 'Deterministic reference policies', description: 'Offline mechanism demonstration; no language-model calls.' },
      { id: 'openai', label: 'Live model agents', description: 'Model decisions and analysis through a server-configured API key.' },
    ],
    limits: { attempts: 5, seeds: 50, liveSeeds: 3, requestBytes: MAX_BODY_BYTES },
  };
}

const boundedInteger = (value, name, min, max, fallback) => {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < min || selected > max) throw new InputError(`${name} must be an integer between ${min} and ${max}.`);
  return selected;
};

export function validateOptions(input, operation = 'compare') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Provide a JSON object with experiment options.');
  const allowed = new Set(['scenarioId', 'scenario', 'seed', 'attempts', 'mode', 'policyKind', 'model', 'analysisBudget', 'seedCount', 'seeds']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new InputError(`Unknown experiment option: ${key}.`);
  const scenarioId = input.scenarioId ?? input.scenario ?? 'webhook_release';
  if (!engine.SCENARIOS.some(item => item.id === scenarioId)) throw new InputError('Choose a scenario listed in /api/config.');
  const policyKind = input.policyKind ?? 'reference';
  if (!['reference', 'openai'].includes(policyKind)) throw new InputError('policyKind must be reference or openai.');
  const options = {
    scenarioId, policyKind,
    seed: boundedInteger(input.seed, 'seed', 0, 2147483647, 42),
    attempts: boundedInteger(input.attempts, 'attempts', 1, 5, 2),
    analysisBudget: boundedInteger(input.analysisBudget, 'analysisBudget', 0, 100, 24),
  };
  if (operation === 'run') {
    options.mode = MODE_ALIASES[input.mode] ?? input.mode ?? 'temporal_pincer';
    const ids = engine.MODES.map(item => typeof item === 'string' ? item : item.id);
    if (!ids.includes(options.mode)) throw new InputError('Choose a mode listed in /api/config.');
  }
  if (input.model !== undefined) {
    if (typeof input.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(input.model)) throw new InputError('model must be a valid model identifier.');
    options.model = input.model;
  }
  if (operation === 'benchmark') {
    options.seedCount = boundedInteger(input.seedCount ?? input.seeds, 'seedCount', 1, policyKind === 'openai' ? 3 : 50, policyKind === 'openai' ? 1 : 10);
    if (options.seed + options.seedCount - 1 > 2147483647) throw new InputError('The benchmark seed range exceeds the supported maximum.');
  }
  return options;
}

export async function execute(operation, input, { signal } = {}) {
  const options = validateOptions(input, operation);
  const policy = options.policyKind === 'openai' ? createModelPolicy({
    model: options.model || DEFAULT_MODEL, signal,
    maxOutputTokens: environmentInteger('OPENAI_MAX_OUTPUT_TOKENS', 1200, 256, 8192),
    maxCalls: environmentInteger('OPENAI_MAX_CALLS', 300, 1, 1000),
  }) : undefined;
  const runOptions = { ...options, ...(policy ? { policy } : {}) };
  let result;
  if (operation === 'benchmark') {
    const comparisons = [];
    for (let index = 0; index < options.seedCount; index += 1) {
      if (signal?.aborted) throw new InputError('The experiment was cancelled.', 499, 'CANCELLED');
      const singleOptions = { ...runOptions, seed: options.seed + index };
      comparisons.push(await (policy ? engine.runComparisonAsync(singleOptions) : engine.runComparison(singleOptions)));
    }
    result = { kind: 'benchmark', options, comparisons, summary: aggregateComparisons(comparisons),
      protocol: 'Paired seeds; within each seed, all three modes share one first-attempt source trajectory. Reference-policy scores are demonstration results, not evidence of language-model efficacy.' };
  } else if (operation === 'run') {
    result = await (policy ? engine.runExperimentAsync(runOptions) : engine.runExperiment(runOptions));
  } else {
    result = await (policy ? engine.runComparisonAsync(runOptions) : engine.runComparison(runOptions));
  }
  return { ...result, policyKind: options.policyKind, ...(policy ? { modelUsage: policy.usage() } : {}) };
}

// Aggregates paired results without inventing benchmark uncertainty or model-cost estimates.
export function aggregateComparisons(comparisons) {
  const modes = new Map();
  for (const comparison of comparisons) {
    for (const run of comparison.runs || []) {
      const mode = run.mode;
      if (!modes.has(mode)) modes.set(mode, { mode, seeds: 0, successes: 0, totalActions: 0, totalAttempts: 0, totalToolCost: 0, totalExecutionActions: 0, totalReplayActions: 0, totalExecutionCost: 0, totalReplayCost: 0 });
      const row = modes.get(mode);
      const attempts = run.attempts || [];
      const last = attempts.at(-1);
      row.seeds += 1;
      row.successes += Number(Boolean(run.metrics?.success ?? last?.outcome?.success ?? run.success));
      row.totalAttempts += attempts.length;
      row.totalActions += Number(run.metrics?.actions) || attempts.reduce((sum, attempt) => sum + (attempt.steps?.length || 0), 0);
      row.totalToolCost += Number(run.metrics?.cost) || attempts.reduce((sum, attempt) => sum + Number(attempt.cost || 0), 0);
      row.totalExecutionActions += Number(run.metrics?.executionActions) || 0;
      row.totalReplayActions += Number(run.metrics?.replayActions) || 0;
      row.totalExecutionCost += Number(run.metrics?.executionCost) || 0;
      row.totalReplayCost += Number(run.metrics?.replayCost) || 0;
    }
  }
  return [...modes.values()].map(row => ({ ...row, successRate: row.successes / row.seeds,
    averageActions: row.totalActions / row.seeds, averageAttempts: row.totalAttempts / row.seeds,
    averageToolCost: row.totalToolCost / row.seeds }));
}

function environmentInteger(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new InputError(`${name} is outside the server's supported range.`, 500, 'SERVER_CONFIG');
  return value;
}

export function publicError(error) {
  if (error instanceof InputError) return { status: error.status, error: { code: error.code, message: error.message } };
  if (error instanceof ModelError) return { status: error.code === 'MODEL_NOT_CONFIGURED' ? 503 : 502, error: { code: error.code, message: error.message } };
  return { status: 500, error: { code: 'EXPERIMENT_ERROR', message: 'The experiment could not complete. Check the local server terminal for a diagnostic code.' } };
}

function sendJSON(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJSON(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new InputError('Use Content-Type: application/json.', 415, 'CONTENT_TYPE');
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) throw new InputError('The request body is too large.', 413, 'BODY_TOO_LARGE');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new InputError('The request body is too large.', 413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('The request body must contain valid JSON.'); }
}

function validateLocalRequest(request) {
  let host;
  try { host = new URL(`http://${request.headers.host}`).hostname; }
  catch { throw new InputError('Invalid local host.', 403, 'LOCAL_ONLY'); }
  if (!LOOPBACK.has(host)) throw new InputError('This development server accepts only localhost requests.', 403, 'LOCAL_ONLY');
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) throw new InputError('Cross-origin requests are not allowed.', 403, 'ORIGIN');
}

async function serveStatic(urlPath, response, headOnly) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath); }
  catch { throw new InputError('Invalid URL encoding.'); }
  const publicRoot = path.join(ROOT, 'public');
  const targetRoot = pathname.startsWith('/engine/') ? path.join(ROOT, 'engine') : publicRoot;
  const relative = pathname.startsWith('/engine/') ? pathname.slice('/engine/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(targetRoot, relative);
  if (!file.startsWith(`${targetRoot}${path.sep}`)) throw new InputError('File not found.', 404, 'NOT_FOUND');
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[path.extname(file)];
  if (!type || (targetRoot.endsWith(`${path.sep}engine`) && !['.js', '.mjs'].includes(path.extname(file)))) throw new InputError('File not found.', 404, 'NOT_FOUND');
  let body;
  try { body = await readFile(file); }
  catch { throw new InputError('File not found.', 404, 'NOT_FOUND'); }
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  response.end(headOnly ? undefined : body);
}

export function createServer() {
  let busy = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      validateLocalRequest(request);
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api/config' && request.method === 'GET') return sendJSON(response, 200, config());
      const operation = { '/api/run': 'run', '/api/compare': 'compare', '/api/benchmark': 'benchmark' }[pathname];
      if (operation) {
        if (request.method !== 'POST') throw new InputError('Use POST for this endpoint.', 405, 'METHOD');
        if (busy) throw new InputError('An experiment is already running. Wait for it to finish.', 409, 'BUSY');
        const input = await readJSON(request);
        validateOptions(input, operation);
        // Reading a body yields; recheck before acquiring the single-run slot.
        if (busy) throw new InputError('An experiment is already running. Wait for it to finish.', 409, 'BUSY');
        const controller = new AbortController();
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        busy = true;
        try { return sendJSON(response, 200, await execute(operation, input, { signal: controller.signal })); }
        finally { busy = false; }
      }
      if (pathname.startsWith('/api/')) throw new InputError('Endpoint not found.', 404, 'NOT_FOUND');
      if (!['GET', 'HEAD'].includes(request.method)) throw new InputError('Method not allowed.', 405, 'METHOD');
      await serveStatic(pathname, response, request.method === 'HEAD');
    } catch (error) {
      const failure = publicError(error);
      if (failure.status === 500) console.error(`Turnstile diagnostic: ${error?.name || 'Error'}; request failed.`);
      if (!response.destroyed && !response.headersSent) sendJSON(response, failure.status, { error: failure.error });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = environmentInteger('PORT', 4173, 1, 65535);
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT to another local port.` : 'The local server could not start.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Turnstile is ready at http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
