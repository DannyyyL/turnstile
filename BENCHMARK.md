# Benchmark v0.5 protocol

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?** Learning and fresh prediction are primary; checkable explanations of past behavior are separate secondary diagnostics. [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md) records the charter and [RELATED_WORK.md](RELATED_WORK.md) situates the project without novelty assumptions.

Version **0.5.0**, benchmark schema **4**, introduces the default `dynamics` suite. The published-rule state tasks remain under explicit `suite: temporal`, and the six mixed earlier tasks remain `legacy`. Their meanings and saved reports are preserved. Never pool these protocols or present historical model pilots as evidence for the new task.

## Dynamics task: `delayed_commit`

The default public **development** template belongs to family `dynamics_learning`. It presents three completed calibration runs, then six categorical prediction queries about one fresh run of the same unfamiliar deterministic mechanism. Calibration observations execute automatically and earn no score. Every forecast query invokes the policy. Step records identify `phase: calibration|forecast`.

The actor must infer a hidden delay and the effect of additional input while an update is pending. Calibration observations identify the rule within the declared candidate family. The fresh input timing/composition differs from the observed runs, testing predictive application. Its six horizon queries are correlated measurements of the same run, not six independent trials. The evaluator holds the mechanism, answer closures and unseen future outputs separately; none is inserted into default actor or analyst contexts, including nested snapshots. Predictions are frozen through the selected actions; query transitions record the commitment without revealing correctness or future outputs during that attempt.


The hypothesis family has six mechanisms: delay 2, 4 or 6 time units, crossed with repeated pending inputs that either restart the deadline or are ignored. An `arm` while idle creates a pending update. An `arm` while pending follows that mechanism's retrigger rule. `cancel` removes a pending update. Commitment is absorbing. A deadline at the same time as an input commits first; same-time inputs follow list order and snapshots describe the state after inputs. Actors receive the hypothesis family and calibration evidence, not the selected parameters by default.

All six predictions share an issue time of 20 and the fresh input plan `arm@20, arm@21, cancel@21, arm@24, arm@25`. They predict categorical state (`idle`, `pending`, `committed` or `underdetermined`) at six horizons. The first horizon is 25 in base and 32 in the shifted variant; the remaining horizons are 26, 27, 28, 29 and 30. The latter five together distinguish the six candidate mechanisms. All queries are committed without intervening future observations.

`ruleAccess: infer` is the default. `given` provides the actual mechanism in public context as an explicit control, separating difficulty learning a rule from difficulty applying it. Inferred-rule performance alone does not establish how the model represented the mechanism. No written explanation or mechanism declaration is required for prediction credit.

The primary score is **unseen-future prediction accuracy**: the fraction of the six categorical forecast checks passed. All six must pass for task success. Calibration receives no credit. This is deterministic categorical prediction, not probabilistic calibration, model-weight training or real-world forecasting. Policy errors preserve partial traces and null scores with explicit coverage, never a scripted fallback.

This release permits **attempts: 1** and **strategies: ['forward_only']** only in `dynamics`. It does not evaluate pincer, reflection or trace-memory dynamics learning. Once a continuation is revealed, retrying it would test same-instance recovery rather than an unseen future. Future learning strategies must transfer to fresh futures and receive their own explicit protocol.

There is no dynamics evaluation split. `split: development` is the supported split; public label/option randomization does not create independent task structures or held-out evidence. The offline reference learner uses only public calibration evidence to infer the rule and predict. Its success verifies the instrument, not a language model's ability.

## Dynamics controls and interfaces

```powershell
node cli.mjs evaluate --task delayed_commit --seed 42 --output results-infer.json
node cli.mjs evaluate --task delayed_commit --rule-access given --output results-given.json
node cli.mjs evaluate --task delayed_commit --variant temporal_shift --output results-timing.json
node cli.mjs validate --seeds 3 --output results-dynamics-controls.json
```

Default `suite` is `dynamics`; `ruleAccess` is `infer`, variant `base`, interference 0, seed 42, seedCount 1, one attempt and unassisted strategy. Standard seed/model limits remain unchanged. A dynamics run cannot request analyzed strategies or same-instance retries. CLI/API validation rejects unsupported configurations before execution.

The fixed dynamics validation matrix is:

| ID | Timing variant | Mechanism access |
| --- | --- | --- |
| `base_infer` | `base` | `infer` |
| `shifted_infer` | `temporal_shift` | `infer` |
| `base_given` | `base` | `given` |
| `shifted_given` | `temporal_shift` | `given` |

The timing variant changes only one query horizon, preserving the input plan, calibration and mechanism while requiring at least one expected answer to differ. Provided-rule comparisons hold the task fixed and add mechanism information deliberately. `timing_infer` and `timing_given` compare timings; `supplied_rules_base` and `supplied_rules_shifted` compare inferred versus provided rules. Interpret differences as descriptive treatment-minus-control prediction-score points. Independent model responses can differ even with matched environment seeds. No significance or causal/strategy advantage is inferred.

Dynamics validation wrappers use schema **3** and contain schema-4 benchmark reports, every condition, paired records/summaries, error and complete-pair coverage, costs and fingerprints. Individual score deltas are null if either paired attempt is incomplete. Timing and mechanism comparisons overlap conditions and must not be pooled as independent observations. Paired correctness on the first horizon flip is a secondary timing-sensitivity control: it can be solved without identifying the mechanism. It must not replace six-query prediction accuracy as the learning measurement. No expected answer labels or hidden mechanism are exposed by evaluator audit summaries.

`POST /api/evaluate` accepts suite, taskId, split, variant, ruleAccess, interference and the common model/seed fields. `POST /api/validate` fixes the four conditions and accepts suite plus common seed/model/budget fields; it does not accept individual task/variant/ruleAccess overrides. `GET /api/config` exposes tasks with their suite, rule-access modes and suite-specific restrictions. The browser defaults to dynamics, exposes the infer/given control, and hides unavailable recovery settings. Selecting the foundational temporal suite restores its existing controls.

The inspector distinguishes observed calibration examples from scored forecast commitments. The collapsed **Public task brief** shows the recorded objective, candidate mechanisms and public rules; the selected mechanism appears there only in the supplied-rule control. Dynamics results lead with prediction accuracy and all-query success. Opening saved JSON remains local, without uploads or model calls; imports accept benchmark schemas **1–4** and validation wrappers **1–3**. Shape validation and escaped rendering do not prove report authenticity or independently verify its recorded hash.

## Matched-mechanism pilot

`matched` runs the development pairs for the selected task. Within each pair the hidden mechanism changes while the calibration input schedules, future inputs, forecast horizons and choices stay fixed. In inferred-rule mode, the observed calibration states are the only public difference. Every case starts fresh and freezes its forecasts before scoring.

```powershell
node cli.mjs matched --output results-matched.json
node cli.mjs matched --task coupled_commit --output results-coupled.json
node cli.mjs matched --task coupled_commit --pairs 1,5 --output results-coupled-two-pair.json
node cli.mjs matched --task coupled_feedback --pairs 3,6 --output results-coupled-feedback.json
node cli.mjs matched --condition infer --seed 42 --output results-matched-infer.json
```

The default task is `delayed_commit` and the default policy is `reference`. `--seed` controls reproducible generation. Each case has six queries. The optional `--pairs` accepts a comma-separated list of distinct pair IDs and runs them in the specified order across conditions. Omit it to run all pairs. The original tasks have eight pairs each and `coupled_feedback` has six. Reports preserve the selection in `options.pairIds` and use the existing zero-based `pairIndex` for individual records. `--condition` accepts `infer`, `given`, or `ablated`, and omitting it runs all three. Every report includes an offline fixed-state baseline. `--policy compatible|openai` and `--model` use the existing configured model transport. Each pair costs up to 12 requests per selected condition, so two pairs across all three conditions use up to 72 requests. The matched tasks run through the CLI and emit a distinct `matched_dynamics` report with schema version 1.

| Condition | Evidence available |
| --- | --- |
| `infer` | Observed calibration states and candidate rules |
| `given` | The same observations plus the actual mechanism |
| `ablated` | The same calibration input schedules with observed states withheld |
| Fixed-state baseline | The same task as `infer` with a policy that chooses one state for every forecast |

All conditions are scored against the same realized outcomes for each case. Ambiguity in the ablated condition is intentional. It measures how well the forecasts do without the evidence that identifies the rule. The offline ablated policy simulates each public candidate mechanism and predicts the plurality state with a fixed tie-break. In `delayed_commit`, the tie order is `idle`, `pending`, `committed`, and the fixed-state baseline is `always_pending`.

The primary pilot metric is **paired accuracy on answer flips**. A forecast horizon contributes a point only when the predicted state is correct on both sides of the pair and the oracle answers differ. A constant guess across the two sides earns zero credit on those horizons. Forecast accuracy over completed cases is reported separately. The report counts required and scored flips and marks incomplete pairs with null paired scores. Forecasts share trajectories, and pairs within each task share a mechanism family. Treat the results as descriptive development evidence.

### Coupled delayed commitment

`coupled_commit` asks for the joint state of two interacting delayed processes at each horizon. The 36 candidate mechanisms combine a left delay and a right delay (each 2, 4 or 6 time units), a shared pending-input rule (`restart` or `keep`), and a coupling rule. Under `relay`, a commitment arms the other process. Under `cut`, it cancels the other process. Commitments due at the same time settle together before any coupling operations, then external inputs execute in their listed order.

The three calibration runs expose snapshots of joint states. Forecast schedules combine inputs in fresh sequences, so the model has to carry changes in one process through to their effects on the other. A forecast earns credit when both states are correct. Four pairs vary only the coupling rule. The fixed-state baseline `always_committed_committed` predicts both processes are committed at every horizon, the most common joint state in this public batch. The calibration-blind plurality policy breaks ties by left state, then right state, using `idle`, `pending`, `committed` order on each side. Run the original and coupled tasks separately so their scores and coverage remain distinguishable.

### Coupled timers with feedback

`coupled_feedback` adds temporary commitments and cross-channel signals that arrive after a delay. A channel can expire, receive a signal, and commit again. The three observed runs identify the mechanism among 144 candidates. The fresh schedules in pairs 3 and 6 each have 20 external events. Together those pairs have 24 forecasts and 10 paired checks. At seed 42, the reference learner scored 24/24 and 10/10, the calibration-blind policy scored 6/24 and 0/10, and guessing both committed scored 3/24 and 0/10.

## Evidence and limits

The [harder follow-up](http://127.0.0.1:4173/?pilot=hard#results) reran the three models that tied at the original pilot ceiling. With medium reasoning effort, GPT-6.1 Terra scored 24/24 forecasts and 10/10 paired checks, Gemini 3.8 Flash scored 19/24 and 6/10, and GPT-6 Luna scored 17/24 and 6/10. The chart uses the first complete attempt for each case in the revised runs. Response caps were 5,000 tokens for Terra and 12,000 for Luna. Gemini used 5,000 for three cases and 12,000 for the case retried after truncation. The score data records the caps by case and the source report hashes. This is one run per model on four cases.

The [homepage pilot](http://127.0.0.1:4173/#results) compares model runs on `coupled_commit` pairs 1 and 5, seed 42, with calibration observations available and the hidden rule withheld. Each plotted model completed 24 forecasts and 11 paired checks. The reference learner scored 24/24 and 11/11. The fixed guess “both finished” scored 5/24 and 0/11. Model runs used OpenRouter, structured JSON responses, a 4,096-token output cap and provider-default sampling. Extended reasoning was disabled for Claude Haiku, Gemini and Nemotron. The Qwen3 235B run was incomplete after provider response errors and is excluded from the chart. The homepage reads aggregate scores and report hashes from `public/pilot-scores.json`. Full local reports stay in ignored files. These four public cases support a descriptive comparison.

An initial local Llama 3 8B run on `delayed_commit` scored 4/6 on seed 42. Every correct answer in that case was `pending`, so an always-`pending` policy would score 6/6. The matched pilot checks whether the forecast changes correctly when evidence changes. Tests use offline policies, public-evidence solvers, mock model transports and localhost API checks only. The archived paid-pilot script is guarded to v0.3.0 and refuses against this checkout.

The next evidence should include more independent temporal mechanisms, structurally held-out cases and repeated model trials. The current development tasks use public deterministic systems with declared candidate mechanisms. The scores describe forecasting performance on those systems. Optional checkable past explanations remain outside the dynamics score.

## Preserved temporal and shared reference

The following sections describe foundational `suite: temporal` task semantics, its controls and optional recovery, followed by shared transport/report contracts and legacy evidence. These are separate from the dynamics task above. Current runs emit schema 4; older task/report versions retain their own recorded interpretation. Use explicit `--suite temporal` for foundational commands.
## Foundational temporal task contract (`suite: temporal`)

The foundational family is `temporal_state_tracking`. Each attempt has 14 ordered checkpoints: ten forced record arrivals and four query decisions at checkpoints 4, 8, 11 and 14. Labels are categorical, with no numerical meaning. Actions have zero effort cost and there is no effort budget, plan search, resource allocation or reservation arithmetic.

The actor receives public rules, the current observation, available actions, complete current-attempt history and strategy-permitted assistance. It returns `{actionId, reasoning}`. Assignment records contain an ID, `receivedTime`, `effectiveTime` and label. A retraction names the assignment it removes. Query observations specify `effectiveTime` and `knowledgeTime`.

For a query:

1. Use only records received by its knowledge time. Future arrivals are unavailable.
2. Remove assignments targeted by retractions received by that knowledge time.
3. Among remaining assignments effective at or before the queried effective time, select the greatest effective time. Effective times are distinct; arrival order does not determine precedence.
4. Return its label, or `unknown` if none is known to apply.

A late record can revise a later answer about the past. Retraction removes its target from subsequent knowledge snapshots, including historical queries; another non-retracted assignment can then apply. A prior answer is not new evidence. There is no expiry rule in the focused tasks.

| ID | Public split | Structure |
| --- | --- | --- |
| `temporal_history` | `development` | Queries effective times 1, 6, 8 and 12 at successive knowledge times; late older records, future-effective records and insufficient evidence prevent a latest-arrival shortcut. |
| `temporal_revision` | `evaluation` | Repeats the query about effective time 5 as late information arrives and assignments are retracted, distinguishing the same past from successive knowledge states. |

Seeded labels and option order vary while event structure stays fixed. Relabeling does not create independent task diversity. Both templates and splits are public source, not secret, contamination-proof or untouched held-out cases.

Every forced single-option step executes automatically for all policies and interfaces. Its observation, transition and normal effort remain in history. Steps record `execution: automatic|policy`, and attempts record `automaticActions` and `policyDecisions`. Ten automatic arrivals therefore require no actor call; the four genuine queries use the configured policy. Do not pool earlier all-checkpoint v0.2 costs with this protocol.

The evaluator alone holds the expected answers. Task IDs, seeds, future records, answer closures and evaluator audit hooks are excluded from actor and analyst contexts, including nested snapshots. Report checks state correctness without revealing expected labels. The evaluator audit records changed query counts and checkpoint IDs, not answer keys.

## Time-essential acceptance criterion

`variant: base|temporal_shift` changes a timestamp while preserving non-temporal facts, arrival order, labels and answer options. For each task and seed, at least one expected answer must change. In `temporal_history` the changed effective time changes the answer at query 8. In `temporal_revision` the changed effective time changes whether a late assignment revises the earlier state at query 8.

`interference: 0..3` adds irrelevant maintenance observations to forced arrival steps. These observations change context length but must leave task state, options and all expected answers unchanged. The maintenance irrelevance rule appears in clean and distracted briefs.

These acceptance checks establish that the generated cases depend on temporal relationships. They do not establish research novelty, that every subquestion is time-essential, or that a model used a particular internal reasoning process. Uniform translation of effective, received and query clocks is unit-tested for both tasks and variants, preserving answers and action order. No model-invariance experiment is claimed; independently authored structures remain future work.

## Automatic scoring and recovery

Each of the four query checks has equal weight. Attempt score is the fraction correct in [0,1]; task success requires all four. Scores are assigned after the attempt, so correctness feedback cannot steer later queries in that same attempt. An error retains the partial trace and has null score, with no scripted fallback.

Standalone measurements are `firstAttemptScore` and `firstAttemptSuccess`, summarized as `meanFirstAttemptScore` and first-attempt success rate. Timestamp-blind shortcuts can score highly on individual fixed-template queries; matched paired temporal accuracy is the stronger temporal diagnostic and is displayed prominently in validation results. `finalScore` and `finalSuccess` describe the last executed attempt. `recoveryEligible` requires a completed unsuccessful first attempt; `recoveredAfterFailure` additionally requires later actual success. Recovery rate is null when there are no eligible failures. Immediate success earns full task credit and no recovery credit.

| Strategy | Memory on a later attempt | Analyst and delivery |
| --- | --- | --- |
| `forward_only` | None | No analyst; an unassisted first attempt and fresh retries |
| `trace_memory` | Completed previous traces and outcomes | No analyst; raw traces available from retry start |
| `reflection` | Accumulated verified notes | Complete trajectory in forward order; notes available from retry start |
| `temporal_pincer` | Accumulated verified notes | Same trajectory in reverse order; notes delivered at matching semantic checkpoints |

One physical unassisted source attempt is shared across selected strategies, with independent copies. These rows are not independent first-attempt trials. Retries reset the same instance. Runs stop on success, policy error or attempt limit. Default selection is `forward_only` with one attempt; other strategies and later attempts are explicit recovery studies.

Actors and both analysts share the same client, output limit and completed observable evidence. Analysts use the same recommendation schema and replay budget, while instructions and serialized traversal order differ. The deterministic reference critic enumerates public alternatives; it is evaluator plumbing, not evidence of model reasoning ability. Its actor does not exploit raw trace memory.

Analysts propose at most eight `{targetT, actionId, reasoning}` replacements. Invalid, duplicate, budget-exhausted and unsuccessful proposals remain recorded. Each distinct valid candidate consumes at most one evaluator replay, changing one decision under the fixed seed while holding all other recorded actions fixed. No model call is made during replay.

Deliverable notes must remove an observed failure, introduce no new failure and satisfy any task effort constraints. A locally verified repair can leave other failures; only actual later execution establishes recovery. Notes accumulate across rounds and can interact. Pincer notes never reach their source attempt or an unrelated checkpoint.

Reflection versus pincer combines traversal order and delivery timing; total compute is not matched across all strategies. Independent traversal/timing ablations, context controls and repeated model trials are required before attributing an advantage. A tie is a valid outcome.

## Browser, CLI and API

Start `npm start`, open [the workbench](http://127.0.0.1:4173), and choose Foundational state tracking in the suite selector. Then choose split, task and agent. Advanced settings expose seeds, timestamp variant, interference, attempts, replay budget and optional recovery strategies. Offline reference, one attempt and `forward_only` are the defaults. A configured provider may incur charges only after Run is selected; no experiment starts automatically. Credentials and endpoints are server environment settings, never browser fields.

Results separate first-attempt accuracy/success from final results and recovery. Inspect observations, answers, automatic/policy execution, notes and accepted/rejected replays. Validation adds condition selection, temporal-pair accuracy, descriptive deltas and coverage. Cancel retains the preceding report. Export before reload, or open saved JSON locally without uploading data or making a model call. Imports accept benchmark schemas 1–4 and validation wrappers 1–3. Import validates supported shapes and escapes text; it does not certify origin or verify a saved hash.

```powershell
node cli.mjs evaluate --suite temporal --task temporal_history --output results-history.json
node cli.mjs evaluate --suite temporal --split evaluation --variant temporal_shift --interference 3 --output results-revision.json
node cli.mjs evaluate --suite temporal --task temporal_history --attempts 2 --strategies forward_only,reflection,temporal_pincer --analysis-budget 4 --output results-recovery.json
```

| CLI option | Temporal-suite default | Limits |
| --- | --- | --- |
| `--suite` | `temporal` | `temporal`, `legacy` |
| `--task` | All tasks in selected split | `temporal_history`, `temporal_revision` |
| `--family` | `temporal_state_tracking` | Active family only in focused suite |
| `--split` | `development` | `development`, `evaluation`, `all` |
| `--variant` | `base` | `base`, `temporal_shift` |
| `--interference` | 0 | 0–3 irrelevant observations per forced step |
| `--seed`, `--seeds` | 42, 1 | Start 0–2147483647; 1–50 offline or 1–3 network seeds |
| `--attempts` | 1 | 1–5, shared source included |
| `--strategies` | `forward_only` | Distinct comma-separated strategy IDs |
| `--analysis-budget` | 24 | 0–100 replays per analyzed round |
| `--policy` | `reference` | `reference`, `openai`, `compatible` |
| `--model` | Server environment | Optional model ID override |
| `--output` | Standard output | New JSON file; never overwrites |

`POST /api/evaluate` accepts equivalent camel-case fields: `suite`, `taskId`, `family`, `split`, `variant`, `interference`, `seed`, `seedCount`, `attempts`, `analysisBudget`, `strategies` (array), `policyKind`, `model`. `GET /api/config` exposes active `tasks`, historical `legacyTasks`, strategies, controls, limits and safe provider metadata. Browser endpoint/credential overrides are rejected.

## Matched validation

`node cli.mjs validate --suite temporal` and `POST /api/validate` run four fixed conditions on the task in the chosen `development` or `evaluation` split:

| Condition | Timestamp variant | Interference |
| --- | --- | --- |
| `base_clean` | `base` | 0 |
| `shifted_clean` | `temporal_shift` | 0 |
| `base_distracted` | `base` | 3 |
| `shifted_distracted` | `temporal_shift` | 3 |

The two timestamp comparisons vary temporal metadata at each noise level; the two noise comparisons vary irrelevant observations at each timestamp variant. Validation accepts `split`, `seed`, `seedCount`, `attempts`, `analysisBudget`, `policyKind`, `model`, `strategies`, and optional `suite`. Defaults are one seed, one attempt, the unassisted strategy and four replays per analyzed round. Limits are ten offline/custom seeds, three network seeds and at most two attempts. The matrix fixes task/variant/interference; overrides for them are rejected. Split `all` is unsupported for a fixed validation run.

Each condition gets a fresh physical unassisted source, shared only among that condition's selected strategies. Environment seeds match instances; stochastic model actions remain independent across conditions. Score deltas are treatment minus control in score points, not relative improvements. First deltas are null unless both first attempts completed; final deltas require both selected runs to complete. Errors and incomplete coverage remain explicit.

The wrapper uses kind `temporal_validation`, schema **2**, and embeds four schema-4 benchmark reports. Each timestamp pair records `temporalNecessity`: whether only temporal metadata changed, whether answer changes are expected, and changed-query counts/checkpoint IDs per case. No expected labels are exposed. `requiredFlipQueries` counts queries whose answers must differ among complete pairs; `bothCorrectFlipQueries` counts those answered correctly in both conditions. Their ratio, `pairedTemporalAccuracy`, is an unassisted measure and is null for incomplete temporal pairs or irrelevant-noise comparisons. Merely flipping an answer is insufficient. `completeFirstPairs` and incomplete/error counts expose coverage; do not confuse a partial complete-pair result with full coverage.

Paired summaries overlap the same underlying cases. They are descriptive and must not be pooled as independent observations. No confidence interval, significance or mechanism advantage is automatically inferred.

## Shared model interface

`createModelPolicy` in `model.mjs` provides `decide`, `reflect`, `invert` and `usage`. `createModelClient` in `model-client.mjs` provides `complete({kind, context, schema, instructions})` returning a schema-valid JSON object, plus cumulative `usage()`. Calls are stateless: supplied context is the full permitted memory. Custom adapters must not retain hidden conversational state across cases or strategies.

The Responses transport uses structured output and `store: false`. Compatible transport calls `/chat/completions` with system instructions, a user JSON context and the configured format. Both enforce local schema validation, timeouts, call limits and sanitized errors. Redirects are rejected. There are no automatic retries, JSON repair, provider fallback or reference-policy fallback. Provider compatibility requires runtime testing; mock tests do not certify all endpoints.

| Environment setting | Meaning/default |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Responses credential/model; retained default model `gpt-4.1-mini` is configurable, not a recommendation |
| `OPENAI_MAX_CALLS`, `OPENAI_MAX_OUTPUT_TOKENS` | 300 per operation; 1200 per request |
| `TURNSTILE_BASE_URL`, `TURNSTILE_MODEL` | Required for compatible transport; include `/v1` where required |
| `TURNSTILE_API_KEY` | Optional; keyless local servers may omit it |
| `TURNSTILE_FORMAT` | `json_schema`, or explicit `json_object`/`text` |
| `TURNSTILE_MAX_CALLS`, `TURNSTILE_MAX_OUTPUT_TOKENS` | 300 per operation; 1200 per request |

Environment limits permit 1–1000 calls and 256–8192 output tokens. The client timeout defaults to 45000 ms. Provider sampling defaults are recorded rather than assumed deterministic. HTTPS is required remotely; HTTP is allowed only on loopback. URLs cannot embed credentials, queries or fragments. Reports retain an endpoint hash, not its URL or key. The app does not load `.env` files automatically.

```js
import { createModelPolicy } from './model.mjs';
import { runBenchmark } from './benchmark/index.mjs';

const client = {
  async complete({ kind, context, schema, instructions }) {
    // Actor output: {actionId, reasoning}
    // Analyst output: {summary, recommendations: [{targetT, actionId, reasoning}]}
    return myRuntime.generateJSON({ kind, context, schema, instructions });
  },
  usage() { return { provider: 'custom', model: 'my-model' }; },
};
const report = await runBenchmark(
  { taskId: 'temporal_history', policyKind: 'custom' },
  { policy: createModelPolicy({ client }) },
);
```

Usage may include cumulative `calls`, `inputTokens`, `outputTokens`, `totalTokens`, `unreportedUsageCalls` and provider-reported cost. Omitted usage remains null. Keep secrets out of custom metadata. Direct custom policies may implement the same actor/analyst methods. CLI/API paths never load arbitrary modules or execute model-generated code.

## Reports and reproducibility

Schema-4 benchmark reports record normalized `options`, code/runtime/provider `provenance`, `protocol`, `limitations`, task/seed `cases`, per-family and overall `summary`, physical `costs`, and `reportHash`. Source hashing includes generators, execution/model code, CLI/server and package metadata with CRLF normalized to LF. It captures uncommitted execution code, not a signed release or external provider implementation. Report hash is SHA-256 of compact JSON before adding `reportHash`.

Reports omit wall-clock timestamps. Identical offline code/options/runtime produce identical JSON; task seeds do not make live responses deterministic. Each case records its source-attempt hash, with independent strategy copies. Evaluator instance IDs protect replay from the wrong task/variant and are excluded from model contexts. `protocol.temporalNecessity` describes the timestamp-only flip criterion, not a model-ability claim.

Errors keep partial attempts and sanitized codes. Incomplete attempts have null score. Success rates include errors as unsuccessful while `errors` and scored-case counts expose missing scores. Analyst errors stop that strategy and retain its preceding completed score. CLI writes structured error reports and exits 1; API returns `completed_with_errors`. Invalid configuration fails before execution.

Logical strategy costs each include the shared source; physical totals charge it once plus actual retries. Forward actions/effort, automatic actions, policy decisions, evaluator replay and model calls/tokens remain separate. Replay costs include accepted and rejected proposals. Policy decisions are not synonymous with model calls; analysts add calls without forward actions. Optional provider-reported monetary usage is not an invoice. Missing/failed provider usage can remain unreported.

Schema-1/2/3 historical benchmark exports and schema-1/2 validation wrappers remain importable. Do not pool their task semantics with dynamics-learning scores.

## Preserved legacy scope and evidence

`evaluate --suite legacy` preserves these six tasks. `validate --suite legacy` preserves the eight-condition v0.3 matrix. The old simulator `benchmark` command and `/api/benchmark` retain their original batch meaning; `/demo.html` and `compare --scenario webhook_release` retain the original workbench.

| Historical task | Scope |
| --- | --- |
| `temporal_release`, `temporal_dispatch` | Inspect then choose affordable guards; delayed probes and effort-budget gates |
| `temporal_pipeline` | Coupled encoding/bridge/handoff choices under a seven-unit budget |
| `state_ledger`, `state_access` | Greatest-effective-time state with retractions and exclusive expiry |
| `state_reservations` | Concurrent reservation/release intervals and remaining-capacity arithmetic |

Legacy delay 0–7 changes probe location. `stateMode: updates|temporal` disables/enables invalidation and expiry while retaining effective-time reasoning. Legacy interference preserves answers. All meaningful delayed-family choices precede the changed probe and later noise, so their first-attempt contrasts are negative controls, not evidence of temporal anticipation.

### Historical v0.2 local integration smoke

Existing Ollama 0.17.7 `llama3:8b` Q4_0 CPU weights, context 8192 and temperature 0, completed one unassisted seed-42 attempt per family with a custom singleton-automatic policy. `temporal_release` scored 0.5 (2/4 gates); `state_ledger` scored 0 (0/3). Seven scored model calls reported 7528 tokens. It required no downloads or paid calls. An earlier all-checkpoint attempt was stopped for latency without a valid report. Neither run tested recovery or strategy efficacy, and neither measures v0.4 performance. Ignored local reproduction artifacts remain in `results/`.

### Historical v0.3 hosted pilot

The separately authorized OpenRouter pilot used Llama 3.1 8B and Gemini 2.5 Flash, seed 42, one trial per model: four two-attempt legacy recovery cases and eight first-attempt development controls. It made 138 requests with US$0.11834008 provider-reported cost. [VALIDATION_REPORT.md](VALIDATION_REPORT.md) retains outcomes, errors and limits. It is historical v0.3 evidence, not a ranking, validation certificate or v0.4 result. The archived `scripts/openrouter-pilot.mjs` requires protocol 0.3.0 and refuses to run against this checkout. It is not an entry point for new experiments. Any future hosted study requires explicit spending authorization; no paid calls belong in `npm test`.

## Extension and verification

Add focused task generators in `benchmark/temporal-tasks.mjs`; retain older generators separately. Keep expected answers in evaluator-only closures. New tasks must pass timestamp-only answer-flip and irrelevant-noise invariance checks. Semantic changes require a benchmark version update; format changes require a schema version update.

`npm test` covers engine semantics, temporal generators and boundaries, scoring, fixed-action replay, transport mocks, saved-report rendering, CLI and localhost API. It makes no paid model calls. Independent task structures, preregistered untouched evaluation and repeated model trials remain necessary before stronger research claims.
