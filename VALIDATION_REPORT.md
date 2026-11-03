# Turnstile 0.3 validation pilot

The current project direction is defined in [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md). This pilot and its original next-step recommendations are historical; they do not evaluate learning unknown dynamics or predicting unseen futures.

Historical report: the active v0.4 benchmark now focuses on effective-time history and late revision. The model results below belong to the preserved legacy tasks and do not validate the v0.4 temporal core. No v0.4 model experiment has been run as part of narrowing the benchmark.

Date: 2026-11-02. This is a small integration and task-development pilot, not a model ranking or proof that Turnstile isolates temporal reasoning.

## Findings that matter

The runner now executes single-option operations automatically for every policy, records them in the same observable history, and charges their normal environment effort. Models make every genuine choice. This changes the benchmark protocol to **0.3.0, report schema 2**. It replaces the custom automation used in the earlier local smoke; scores should not be pooled across protocol versions.

Real model runs exercised successful first attempts, unsuccessful attempts, analyst proposals, rejected replays, timed notes, actual recovery, and explicit model errors. On one reservation case, Gemini recovered with trace memory, reflection, and temporal pincer. Pincer tied those baselines. This pilot provides no evidence of a pincer advantage.

The strongest design finding is a limitation: all real choices in the current delayed-consequence templates occur at checkpoints 1–4, before the probe at `5 + delay`. Later delays and distractions therefore cannot affect the unassisted plan. Those first-attempt contrasts are **negative controls for repeated-inference variability**, not measurements of delay sensitivity. A deterministic-policy test verifies that matched decision contexts are identical conditional on identical earlier choices. Different model responses can subsequently make their histories diverge. Future tasks need decisions interleaved with revealing observations to test first-attempt sensitivity to consequence delay.

State-query distractions occur before later genuine choices. Removing invalidation/expiry changes the published rules and correct answers, while preserving event schedules and action order. These are useful development contrasts, but they do not isolate every possible source of difficulty.

## Fixed pilot setup

Two prespecified OpenRouter model IDs were used:

- `meta-llama/llama-3.1-8b-instruct`
- `google/gemini-2.5-flash`

Each used seed 42, one model trial, temperature 0, strict JSON schemas, and the same 1200-token per-call output limit for actors and both analysts. Gemini reasoning was requested disabled; Llama does not expose that capability. No response repair or model fallback was requested. Routing required parameter support and had provider price ceilings. Provider identities and configuration are retained in report metadata. Temperature 0 and task seeds do not guarantee deterministic provider responses.

Each model ran four recovery cases: `temporal_release`, `state_ledger`, `temporal_pipeline`, and `state_reservations`. The allowance was two attempts per strategy with four evaluator replays per analysis round. Fresh retry, trace memory, reflection, and temporal pincer shared one unassisted source within each case. A successful first attempt stopped every strategy without requiring a retry.

Each model also ran the eight development control conditions with one attempt per case: short/long delay crossed with clean/distracted observations, and updates/full-temporal rules crossed with clean/distracted observations. Conditions had fresh source attempts. They did not share memory across conditions.

Execution code was frozen during the pilot. All eight recovery reports identify source SHA-256 `b52b9a0f96f94cab29a84b66a053ba8ff2056c49a75bc011c9127a872d5c9179`. CLI help wording was corrected afterward; the recorded hash identifies the code actually used. Validation wrappers additionally fingerprint the validation runner. Generated reports and original reproduction script remain ignored local artifacts under `results/pilot-v03-2026-11-02T18-53-48-024Z/` and `results/openrouter-pilot-v03.mjs`. The maintained reproduction entry point is [scripts/openrouter-pilot.mjs](scripts/openrouter-pilot.mjs); each new run gets its own output folder and source/policy hashes.

## Recovery results

Scores are fractions of task gates or state queries passed. A score of 1 is full task success. Errors have no task score; they are not zeros. The following rows are individual cases, not aggregate capability estimates.

| Model | Task | Unassisted score | Fresh retry final | Trace-memory final | Reflection final | Pincer final |
| --- | --- | --- | --- | --- | --- | --- |
| Llama 3.1 8B | Release | 0.75 | 0.50 | 0.75 | 0.75; analyst error | 0.75 |
| Llama 3.1 8B | State ledger | 1/3 | 1/3 | 0 | 1/3 | 1/3; analyst error |
| Llama 3.1 8B | Coupled pipeline | 1 | 1 | 1 | 1 | 1 |
| Llama 3.1 8B | Reservation ledger | Unscored: incomplete source | Unscored | Unscored | Unscored | Unscored |
| Gemini 2.5 Flash | Release | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 |
| Gemini 2.5 Flash | State ledger | Unscored: incomplete source | Unscored | Unscored | Unscored | Unscored |
| Gemini 2.5 Flash | Coupled pipeline | 1 | 1 | 1 | 1 | 1 |
| Gemini 2.5 Flash | Reservation ledger | 0 | 1/3 | 1 | 1 | 1 |

Both models succeeded immediately on the coupled pipeline. On Gemini's reservation case, all three memory/assistance conditions recovered while the fresh retry remained unsuccessful. Reflection and pincer each proposed three locally verified corrections. Trace memory recovered without an analyst or replay budget. This is one illustrative recovery case, not an effectiveness estimate.

Llama's release reflection and reservation source hit the output limit. Its state-ledger pincer analyst returned invalid analysis structure. Gemini's separate state-ledger source hit the output limit. Read-only provider metadata lookups confirmed `length`/`MAX_TOKENS` for the three incomplete generations; the non-content audit is retained as `generation-metadata-audit.json` alongside the raw reports. A failed shared source appears in all four strategy rows but represents one physical failure, not four independent events. Analyst-error rows retain the previous completed score, and the error flag remains visible.

We did not rerun errors with a larger output limit or replace them with scripted results. Error handling, output budgets, and provider variability need further measurement before scores can be treated as stable.

## Matched controls

The following state-ledger scores come from the separate first-attempt control runs. All eight control conditions completed without errors for both models. The four strategy rows within a one-attempt condition share the same physical source and are not independent samples.

| Model | Updates, clean | Temporal, clean | Updates, distracted | Temporal, distracted |
| --- | --- | --- | --- | --- |
| Llama 3.1 8B | 2/3 | 1/3 | 2/3 | 0 |
| Gemini 2.5 Flash | 1 | 0 | 1 | 0 |

In these individual cases, both models scored lower under the retraction/expiry rules than under the simpler updates control. That is a reason to study these contrasts with more instances. It is not a causal or general capability claim: the rules and correct-answer distribution differ, one model trial was used, and provider-level variability remains.

All four delayed conditions scored 0.75 for Gemini. Llama scored 0.75 in three and 0.50 in the long/distracted condition. Because those perturbations enter after every genuine choice, Llama's difference cannot be attributed to its seeing the delayed probe or distractors. This negative control shows why repeated trials are necessary even at temperature 0.

## Costs and artifacts

OpenRouter reported **US$0.11834008** across **138 requests**, with no missing cost responses: Llama US$0.02263206 for 66 requests and Gemini US$0.09570802 for 72 requests. This is the provider-reported inference cost, not a claim about account top-up fees or final billing. The approved cap was US$5; the guard reserved a conservative upper estimate of US$2.651592 and also limited request counts and per-provider prices. Read-only key/catalog/generation metadata checks made no additional inference requests.

The folder contains eight individual recovery reports, two full matched-control reports, `manifest.json`, and `progress.ndjson`. Reports retain failed attempts, analyst errors, rejected proposals, physical versus logical effort, model usage, reported cost deltas, and full observable traces. They can be opened locally in the browser using **Open saved JSON report**; importing makes no model call and uploads nothing. Validation imports include condition selection and paired descriptive deltas. Export preserves the full wrapper.

To rerun, explicitly configure `OPENROUTER_API_KEY` in the process and run `node scripts/openrouter-pilot.mjs`. This initiates paid requests. It does not automatically read private credential files, publish results, overwrite previous runs, or change the model set after seeing scores.

## What remains before benchmark claims

1. Add delayed tasks with genuine decisions before and after late observations. Keep the current first-pass matrix as a negative control; use two-attempt matched runs for diagnosis/recovery timing questions.
2. Balance state answers and vary temporal structures. Expand beyond one fixed seed and label shuffling, with repeated provider trials and explicit error/output-budget analysis.
3. Freeze a genuinely separate evaluation study before prompt tuning. The current evaluation split changes structure (coupled planning and additive reservations), but its generators are public and were developed in this session. It is not a secret or contamination-proof holdout.
4. Isolate analyst traversal from note delivery using identical cards for delivery comparisons. Match or explicitly account for total compute before mechanism claims.
5. Examine interacting repairs: a single-decision replay can reject a change that would work only with another coordinated change. Do not treat locally rejected proposals or reported decision-to-detection delays as unique causal truth.

The next research milestone is a preregistered multi-instance validation study using these controls and error rules. The current milestone establishes practical execution and inspectable evidence, while exposing task-design limits that should be addressed before a leaderboard or paper.
