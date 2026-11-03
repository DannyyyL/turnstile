import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createModelClient, createModelPolicy, ModelError } from '../model.mjs';
import { runBenchmark, BENCHMARK_VERSION } from '../benchmark/index.mjs';
import { runValidation } from '../benchmark/validation.mjs';

// This historical paid protocol must not silently execute against new tasks.
if (BENCHMARK_VERSION !== '0.3.0') throw new Error('This archived v0.3 pilot requires the original v0.3 sources. See VALIDATION_REPORT.md; define and approve a new protocol for later versions.');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('Configure OPENROUTER_API_KEY outside this script.');
const models = ['meta-llama/llama-3.1-8b-instruct', 'google/gemini-2.5-flash'];
const output = new URL(`../results/pilot-v03-${new Date().toISOString().replaceAll(/[:.]/g, '-')}/`, import.meta.url);
await mkdir(output);
const policySourceHash = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const ledger = { budgetUSD: 5, conservativeReservationCapUSD: 4.5, reservedUpperUSD: 0, reportedCostUSD: 0, unreportedCostResponses: 0, requests: 0, maxRequests: 240 };
const log = async value => { console.log(JSON.stringify(value)); await appendFile(new URL('progress.ndjson', output), JSON.stringify(value) + '\n'); };
const manifest = { kind: 'pilot_manifest', protocol: 'Turnstile0.3; two prespecified models; one seed; two-attempt recovery and first-attempt matched controls',
  models, seed: 42, settings: { temperature: 0, maxOutputTokens: 1200, replayBudget: 4, noResponseRepair: true, automaticSingletons: true },
  policySourceHash, reports: [], limitations: ['Single seed and one stochastic trial; descriptive integration pilot only.', 'Public structural evaluation split is not a secret or untouched test set.', 'Hosted Llama3.1 is not the earlier local Llama3 Q4_0 deployment.'] };
await log({ event: 'pilot_started', models, output: output.pathname, budgetUSD: ledger.budgetUSD });

async function evaluateModel(model) {
  let costUSD = 0, missingCosts = 0;
  const providers = new Set();
  const transport = createModelClient({ provider: 'compatible', model, baseURL: 'https://openrouter.ai/api/v1', apiKey, format: 'json_schema', maxCalls: 120, maxOutputTokens: 1200, timeoutMs: 90000,
    fetchImpl: async (url, request) => {
      const payload = JSON.parse(request.body);
      payload.temperature = 0;
      if (model.startsWith('google/')) payload.reasoning = { enabled: false };
      payload.provider = { require_parameters: true, allow_fallbacks: false, max_price: { prompt: 1, completion: 5, request: 0 } };
      // Byte-token upper estimate plus framing reserve, with 20% safety margin.
      // Provider price ceilings and no tools/per-request charges bound each call.
      const inputUpper = Buffer.byteLength(JSON.stringify(payload.messages), 'utf8') + 2048;
      const reserveUSD = (inputUpper / 1e6 + 1200 * 5 / 1e6) * 1.2;
      if (ledger.requests >= ledger.maxRequests || ledger.reservedUpperUSD + reserveUSD > ledger.conservativeReservationCapUSD) throw new ModelError('The approved pilot spending guard was reached.', 'PILOT_BUDGET_LIMIT');
      ledger.requests++; ledger.reservedUpperUSD += reserveUSD;
      const requestNumber = ledger.requests;
      const response = await fetch(url, { ...request, body: JSON.stringify(payload) });
      const data = await response.clone().json().catch(() => null);
      if (response.ok) {
        if (Number.isFinite(data?.usage?.cost) && data.usage.cost >= 0) { costUSD += data.usage.cost; ledger.reportedCostUSD += data.usage.cost; }
        else { missingCosts++; ledger.unreportedCostResponses++; }
        if (data?.provider) providers.add(data.provider);
      }
      await log({ event: 'response', model, request: requestNumber, status: response.status, generationId: data?.id ?? null, reportedCostUSD: data?.usage?.cost ?? null });
      return response;
    },
  });
  const client = { usage: () => ({ ...transport.usage(), temperature: 0, reasoning: model.startsWith('google/') ? 'disabled' : 'not supported', policySourceHash,
    reportedCostUSD: costUSD, unreportedCostResponses: missingCosts, routedProviders: [...providers], maxProviderPriceUSDPerMillion: { prompt: 1, completion: 5 } }),
    async complete(request) { await log({ event: 'request', model, kind: request.kind, checkpoint: request.context.checkpointId ?? 'analysis', call: transport.usage().calls + 1 }); return transport.complete(request); } };
  const policy = createModelPolicy({ client });
  for (const [taskId, split] of [['temporal_release', 'development'], ['state_ledger', 'development'], ['temporal_pipeline', 'evaluation'], ['state_reservations', 'evaluation']]) {
    const report = await runBenchmark({ taskId, split, seed: 42, attempts: 2, analysisBudget: 4, policyKind: 'compatible', model }, { policy });
    const file = `${model.replaceAll('/', '--')}--${taskId}.json`;
    await writeFile(new URL(file, output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    manifest.reports.push({ model, taskId, file, kind: report.kind, status: report.status, sourceHash: report.provenance.sourceHash,
      summary: report.summary.filter(r => r.family === 'all'), calls: report.costs.modelUsage.calls });
    await log({ event: 'case_completed', model, taskId, status: report.status, calls: report.costs.modelUsage.calls,
      outcomes: report.cases[0].runs.map(r => ({ strategy: r.strategy, first: r.metrics.firstAttemptScore, final: r.metrics.finalScore, recovered: r.metrics.recoveredAfterFailure, error: r.metrics.error })) });
    await writeFile(new URL('manifest.json', output), JSON.stringify({ ...manifest, ledger }, null, 2) + '\n');
  }
  const controls = await runValidation({ seed: 42, attempts: 1, analysisBudget: 0, policyKind: 'compatible', model, split: 'development' }, { policy });
  const file = `${model.replaceAll('/', '--')}--matched-controls.json`;
  await writeFile(new URL(file, output), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  manifest.reports.push({ model, file, kind: controls.kind, status: controls.status, pairs: controls.pairs.map(p => ({ id: p.id, summary: p.summary })), calls: controls.costs.modelUsage.calls });
  await log({ event: 'model_completed', model, calls: transport.usage().calls, reportedCostUSD: costUSD, controlStatus: controls.status });
}

await Promise.all(models.map(async model => {
  try { await evaluateModel(model); }
  catch (error) { manifest.reports.push({ model, status: 'pilot_error', code: error instanceof ModelError ? error.code : 'PILOT_ERROR' }); await log({ event: 'model_failed', model, code: error instanceof ModelError ? error.code : 'PILOT_ERROR' }); }
}));
await writeFile(new URL('manifest.json', output), JSON.stringify({ ...manifest, ledger }, null, 2) + '\n');
await log({ event: 'pilot_completed', reports: manifest.reports.length, ledger });
