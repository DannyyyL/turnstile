# Local continuation audit

## Core project direction: read first

The user explicitly chose this central question on 2026-11-02:

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?**

Future development should serve [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md): **Observe → Learn → Predict**. Learning dynamics and predicting fresh future episodes are primary. The user refined the direction to keep explaining the past as a secondary, checkable diagnostic, with separate measurements rather than a required part of primary prediction credit. Evidence-arrival bookkeeping is supporting work, not the project's main purpose. Temporal pincer is one optional method alongside fair baselines.

Version 0.5 defaults to the `dynamics` suite. Its `delayed_commit` task presents three observed calibration runs and scores six categorical predictions on one fresh run. Inferred and supplied-rule controls separate learning from application. Benchmark schema 4 and dynamics-validation wrapper schema 3 record this protocol. It permits one unassisted attempt. Pincer and reflection learning, probabilistic forecasts, held-out dynamics structures and real-world transfer remain unimplemented. The local Llama 3 8B smoke scored 4/6 on one case of `delayed_commit`. The separate `coupled_commit` matched pilot has offline controls and hosted model results. See [BENCHMARK.md](BENCHMARK.md#evidence-and-limits).

The v0.4 foundational suite remains explicitly `suite: temporal`; legacy tasks and historical reports are preserved. Browser selection distinguishes the two active suites, calibration/forecast phases and prediction-only scoring. Imports retain benchmark schemas 1–4 and validation wrappers 1–3. Preserve all protocols and historical evidence; do not pool their scores.

## Historical focused v0.4 continuation

The active benchmark is now v0.4.0 with schema-3 reports, narrowed after the user requested temporal reasoning without generic planning. It has two non-arithmetic temporal-state templates: `temporal_history` (development) and `temporal_revision` (public evaluation). They distinguish effective time from received knowledge, including late information and retractions. Four query choices and ten automatic record arrivals replace planning/budget tasks in the default suite. There is no expiry rule in these focused tasks.

Default evaluation is one unassisted `forward_only` attempt. Trace memory, reflection and temporal pincer remain optional recovery strategies, with separate first-attempt and recovery outcomes. Earlier six-task generators, replay/scoring behavior and the eight-condition matrix remain available explicitly under `suite: legacy`. The original simulator workbench remains `/demo.html`, linked as Legacy experiments. No existing implementation or historical reports were discarded.

The active four-condition validation matrix crosses base/changed timestamps with clean/distracted observations. Evaluator audits require a timestamp-only change to flip at least one correct answer, while irrelevant noise preserves all expected answers. Paired temporal accuracy requires both first-attempt answers correct on required flips, with errors and coverage explicit. Generator clock-translation invariance is unit-tested; no model offset experiment has run.

The root browser focuses on historical truth and changing knowledge, defaults to offline/unassisted, and keeps assistance under advanced settings. It can inspect schema-3 benchmarks and schema-2 validation wrappers, while still opening historical benchmark schemas 1/2 and validation schema 1 locally without uploads or inference.

No paid model calls were made for v0.4 development or verification. Historical Ollama and OpenRouter runs below do not measure the new tasks. [VALIDATION_REPORT.md](VALIDATION_REPORT.md) is historical v0.3 evidence. The old paid-pilot script is archived, guarded to protocol 0.3.0, and refuses against this checkout; it must not silently become a v0.4 experiment.

Current tests cover temporal semantics/information boundaries, timestamp-flip/noise invariants, clock translation, optional recovery, reports/import rendering, model transport mocks, CLI and localhost API. The workbench was restarted locally at `http://127.0.0.1:4173` for manual use. Hosted experiments still require explicit authorization and configured server credentials.

Further evaluation of v0.4 would need independent temporal task structures and a preregistered study with repeated model trials. The project's next dynamics-learning milestone is defined in [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md). Two public templates plus acceptance tests are a foundational instrument, not a novelty claim, model ranking or validation certificate. The checkout/cloud history below is preserved to explain which work was recovered, recreated or not found.
## Historical local checkout audit

The local continuation read the “Set up turnstile” chat on 2026-11-02. The checkout was clean at `5d7fdb7`, following framework commit `e45dab5`. No existing working-tree edits were discarded. The historical handoff was read from `e45dab5`; `5d7fdb7` deliberately deleted it. This document supplies the current handoff.

The chat described cloud edits absent from this checkout:

- A `temporal_release` scenario with adjustable delay, optional inspection, an eight-unit effort limit, and first-attempt/recovery measurements.
- Original-workbench controls for that scenario and delay.
- A simpler browser layout, collapsed details, final-attempt selection, and accessibility refinements.
- A locally served Space Grotesk wordmark and font asset.

The chat's later two-family/model-neutral implementation attempt was blocked by an unavailable cloud environment; no completed implementation was reported. The cloud state reportedly had 44 tests; this checkout began with 29. Those exact cloud files and font assets are not present in local commits and have not been recovered.

The local v0.2 release implemented the requested benchmark interface, families, scoring and reports. Its `temporal_release` task recreated the budget/inspection/delay mechanism in the new runner, rather than reconstructing the exact cloud scenario. The old cloud UI assets and font have not been recovered.

The v0.2/v0.3 benchmark browser flow became the root page at `http://127.0.0.1:4173`; the original compatible three-mode workbench is retained at `/demo.html`. The new page configures task/family, seeds, attempts, delay, replay budget, strategies and server-configured model providers. It displays scoring, costs, traces and rejected proposals, supports cancellation and exports full JSON reports. It defaults to offline reference policies and never runs a model automatically. This is a new implementation, not a recovery of the cloud UI assets. The same tasks remain available through CLI, JavaScript and `/api/evaluate`.

Automated tests use deterministic fixtures, mocked transports and localhost API checks. A historical v0.2 Ollama 0.17.7 smoke used existing `llama3:8b` Q4_0 weights on CPU (profile `turnstile-llama3-8b:latest`, context 8192, temperature 0). Its custom policy automated singleton actions and delegated every multi-action decision to the model: one unassisted seed-42 `temporal_release` attempt scored 0.5 (2/4 gates), and one `state_ledger` attempt scored 0 (0/3 queries). Both reports completed without model errors. Seven scored model calls reported 7528 tokens, without downloads or paid API calls. Ignored reproduction artifacts remain in `results/`; see the [historical smoke limits](BENCHMARK.md#historical-v02-local-integration-smoke).

An earlier v0.2 all-checkpoint pilot was stopped for CPU latency after five completed calls and a sixth in flight. It has no valid score/report and is excluded from the completed historical smoke usage. Neither historical run tested recovery or comparative strategy effectiveness.

## Historical v0.3 validation milestone

The benchmark is now version 0.3.0 with schema-2 reports. Forced single-option actions execute automatically for every policy across runner, CLI and browser. They retain normal effort, observations and history and have explicit execution/count fields. This version change must be respected when interpreting v0.2 artifacts; the original v0.1 demo engine is unchanged.

Four development tasks remain the default. Two public evaluation structures add coupled pipeline planning (`temporal_pipeline`) and reservation-interval accounting (`state_reservations`). The evaluation split is not a secret held-out set. State `updates` controls disable invalidation and expiry while retaining effective-time behavior. Interference adds 0–3 irrelevant observations per forced checkpoint without changing task state or correct outcomes.

`node cli.mjs validate`, `/api/validate` and the browser's matched-validation button run eight fixed conditions per selected split. Limits are ten offline or three network seeds and at most two attempts, defaulting to one. Reports preserve conditions, one-factor paired deltas, errors and missing-pair coverage without significance claims. Delayed-family first-pass conditions are negative controls because all meaningful choices precede the changed later evidence; recovery is needed to study its subsequent use. The browser also opens saved schema-1/schema-2 benchmark or validation JSON locally without upload or new inference.

The authorized hosted pilot completed below US$5, using OpenRouter access to `meta-llama/llama-3.1-8b-instruct` and `google/gemini-2.5-flash`, seed 42, one trial per model: four two-attempt recovery cases with replay budget four, plus eight development first-attempt controls. It made 138 requests with US$0.11834008 provider-reported cost. Actual outcomes and errors are recorded in [VALIDATION_REPORT.md](VALIDATION_REPORT.md). Gemini recovered on the reservation case with trace memory, reflection and pincer; this tie is not a mechanism-advantage claim. Paid model calls never belong in `npm test`. Keys, raw generated reports and local logs remain excluded from Git. The historical paid-pilot script is `scripts/openrouter-pilot.mjs`; it is now archived and refuses to run unless the checkout is protocol 0.3.0.

This is a measured-pilot milestone, not proof that the benchmark is validated. Before public distribution, decide licensing and preregister a genuinely untouched structural evaluation with repeated trials, fixed settings and explicit stopping/error rules. Prompt/task tuning on the current public evaluation templates does not create held-out evidence.
