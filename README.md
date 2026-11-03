# Turnstile

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?**

Turnstile is a model-neutral experimental benchmark: **Observe → Learn → Predict**. Its first executable dynamics-learning task is available in **v0.5.0**. A model observes three calibration runs, infers a hidden delay and repeated-input behavior, and commits six categorical predictions about one fresh run before seeing their outcomes. A provided-rule control separates learning a mechanism from applying it. Checkable past explanations remain secondary diagnostics; they are not required for prediction credit.

The default suite starts with **one public development template**. The matched CLI pilot adds a harder coupled-process task. Offline reference learners use public evidence to validate the harness. Evidence for model ability requires model runs across cases. See [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md) and [RELATED_WORK.md](RELATED_WORK.md).

## Run offline

Use **Node.js 22 or later**. There are no external runtime dependencies or installation step.

```powershell
npm test
node cli.mjs tasks
node cli.mjs evaluate --seed 42 --output results-dynamics.json
node cli.mjs evaluate --task delayed_commit --rule-access given --output results-given.json
node cli.mjs validate --seeds 3 --output results-dynamics-controls.json
node cli.mjs matched --output results-matched.json
node cli.mjs matched --task coupled_commit --output results-coupled.json
npm start
```

Open the [Turnstile overview](http://127.0.0.1:4173) for a worked example and the model pilot. The [local workbench](http://127.0.0.1:4173/workbench.html) opens with dynamics learning and an offline reference policy. Choose an agent and run the benchmark to inspect the three unscored examples and six scored forecasts. Advanced settings include seeds, timing, distractors and rule access. **Run matched validation** crosses base and changed timing with inferred and supplied rules in four fixed conditions.

No model call starts automatically. This release permits only one attempt and `forward_only` in the dynamics suite: retrying an already resolved future would not test unseen prediction. Pincer, reflection and trace-memory recovery remain available in the foundational temporal and legacy suites; they are not implemented dynamics-learning strategies in v0.5.

## What the dynamics task tests

`delayed_commit`, family `dynamics_learning`, asks the actor to infer a deterministic system from observed runs. Its hidden mechanism determines the delay before a queued update commits and how additional input affects a pending update. The six predictions share one fresh run with new event timing/composition, so they are not independent trials. Calibration evidence identifies the mechanism within the declared hypothesis family; future query outcomes and evaluator answers remain outside actor and analyst contexts.

The primary score is **unseen-future prediction accuracy**, the fraction of six categorical queries answered correctly. Task success requires all six. Calibration observations earn no score. Predictions are not corrected during the attempt; scoring occurs after completion. Errors retain partial traces and null scores, with explicit coverage and no reference fallback.

`--rule-access infer` is the default; `given` supplies the mechanism as a control. `--variant temporal_shift` changes forecast timing, requiring at least one different correct answer. The four-condition matrix has `base_infer`, `shifted_infer`, `base_given` and `shifted_given`. Timing sensitivity on the first horizon is a secondary control and can be solved without learning the mechanism. All six forecast queries form the primary learning score. Provided-rule contrasts are descriptive, paired by seed, with incomplete-pair and error coverage retained. They do not establish significance or isolate a model's internal reasoning process.

There is no separate dynamics evaluation split yet. More independent mechanisms, held-out structures, simple baseline comparisons and repeated model trials are needed before stronger claims. Deterministic categorical prediction is not calibrated probabilistic forecasting, learning model weights, or real-world forecasting.

## Matched-mechanism pilot

`node cli.mjs matched` runs eight public development pairs for `delayed_commit`. Add `--task coupled_commit` to forecast the joint state of two interacting delayed processes. The two cases in each pair share their calibration input schedules, future input plan and forecast horizons. Their hidden rules differ, producing different calibration observations and different correct forecasts. **Paired accuracy** awards credit at an answer-changing horizon only when both forecasts are correct. The report also shows ordinary forecast accuracy and how many pairs and queries were complete.

The default offline run includes inferred-rule, supplied-rule and calibration-ablated conditions alongside a fixed-state baseline. The ablation hides observed states and grades predictions against the same realized futures, so it measures performance with missing evidence. Use `--condition infer|given|ablated` to select one condition plus the baseline. Use `--pairs 1,5` to run only those two pairs. With a live model, two pairs across all three conditions can make up to 72 requests. The matched tasks run through the CLI and use the same model configuration described below. See [BENCHMARK.md](BENCHMARK.md#matched-mechanism-pilot) for the scoring contract.

## Connect a model

The shared structured interface supports hosted Responses APIs, hosted/local OpenAI-compatible Chat Completions servers, and custom JavaScript clients. Set endpoint and credentials in the server process environment; the app does not load `.env` files automatically. Credentials never belong in browser inputs or reports.

```powershell
$env:TURNSTILE_BASE_URL = 'http://127.0.0.1:1234/v1'
$env:TURNSTILE_MODEL = '<loaded-model-id>'
node cli.mjs evaluate --policy compatible --task delayed_commit --output results-local.json
```

Hosted compatible servers use HTTPS `TURNSTILE_BASE_URL` and their `TURNSTILE_API_KEY`; keyless local servers may omit a key. `TURNSTILE_FORMAT` accepts `json_schema`, `json_object` or `text`, with mandatory local validation. Responses uses `OPENAI_API_KEY` and optional `OPENAI_MODEL` with `--policy openai`. Restart the local server after configuration to expose the provider in the workbench. The browser accepts a model override, never keys or endpoint URLs.

Model commands and Run on a configured provider initiate calls and can incur charges. Tests use mocks and offline policies. A local Llama 3 8B run scored 4/6 on one `delayed_commit` case. The [matched-mechanism pilot](BENCHMARK.md#evidence-and-limits) reports separate results from hosted models. The old paid-pilot script is archived and refuses against this checkout.

## Foundational temporal suite

The v0.4 state-reconstruction tasks remain explicitly available under `suite: temporal`, also selectable in the workbench:

```powershell
node cli.mjs evaluate --suite temporal --task temporal_history --output results-history.json
node cli.mjs evaluate --suite temporal --split evaluation --task temporal_revision --output results-revision.json
node cli.mjs validate --suite temporal --output results-temporal-controls.json
node cli.mjs evaluate --suite temporal --task temporal_history --attempts 2 --strategies forward_only,trace_memory,reflection,temporal_pincer --analysis-budget 4 --output results-recovery.json
```

These published-rule tasks distinguish effective time from received knowledge, late updates and retractions. Their four-condition validation crosses base/changed timestamps with clean/distracted evidence. Paired temporal accuracy requires both answers correct on required answer flips. Keep these foundational measurements separate from dynamics learning.

Same-instance recovery remains a separate historical experiment. Reflection/pincer receive the same completed evidence and replay budget; pincer notes arrive only at matching checkpoints on later attempts. Fixed-seed replay changes one decision while holding the rest fixed, preserving rejected proposals. A local repair need not produce whole-task success. Traversal order and delivery timing remain confounded; a tie is valid.

## Legacy experiments

The six earlier planning/state/reservation tasks remain under `suite: legacy`; legacy validation retains its eight-condition matrix. The [legacy simulator workbench](http://127.0.0.1:4173/demo.html), original `compare`, old `benchmark` command and `/api/benchmark` retain their meanings.

```powershell
node cli.mjs evaluate --suite legacy --task temporal_release --output results-legacy.json
node cli.mjs validate --suite legacy --strategies forward_only --output results-legacy-controls.json
node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2
```

[VALIDATION_REPORT.md](VALIDATION_REPORT.md) preserves the historical v0.3 pilot. [WORKBENCH.md](WORKBENCH.md) documents the original simulator. Do not pool protocols or relabel historical scores as dynamics-learning evidence.

## Reports and interfaces

`evaluate` / `POST /api/evaluate` run tasks; `validate` / `POST /api/validate` run matched conditions. `GET /api/config` exposes safe metadata, provider availability and suite restrictions. JavaScript `runBenchmark` uses the same execution/grading path.

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:4173/api/evaluate -Method Post -ContentType 'application/json' -Body '{"suite":"dynamics","taskId":"delayed_commit","seed":42,"ruleAccess":"infer","policyKind":"reference"}'
```

Benchmark schema **4** and dynamics-validation wrapper schema **3** record options, protocol, source/runtime/provider fingerprints, traces, errors, costs and hashes without secrets or wall-clock timestamps. Identical offline code/options/runtime produce identical JSON; task seeds do not make hosted responses deterministic. `--output` refuses overwrites, and generated reports/logs remain ignored by Git.

The browser imports benchmark schemas 1–4 and validation wrappers 1–3 locally, without uploads or inference. Shape validation/escaped rendering do not certify report origin or independently verify its hash. Export before reload; cancellation retains the previous report. Forward execution, automatic steps, policy decisions, evaluator replay and model usage remain distinct costs.

The server binds to loopback, checks Host/Origin, rejects browser credentials and endpoint overrides, and runs one experiment at a time. Read [BENCHMARK.md](BENCHMARK.md) for exact contracts, [RESEARCH.md](RESEARCH.md) for interpretation limits, and [CLOUD_HANDOFF.md](CLOUD_HANDOFF.md) for preserved work.
