# Turnstile development instructions

Turnstile's core research question is:

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?**

This is the user-chosen purpose of the project. Read [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md) before proposing new work. Build a model-neutral benchmark whose primary goals are learning temporal dynamics and transfer to fresh future predictions. Checkable explanations of the past are secondary diagnostics, reported separately and not required for prediction credit. Temporal pincer is one optional strategy alongside fair baselines; its advantage is not assumed.

The default v0.5 dynamics suite implements `delayed_commit`: three observed calibration runs followed by six fresh-run predictions, with inferred/provided-rule controls. It permits one unassisted attempt (`forward_only`) only. Calibration is unscored; future outcomes remain hidden until completion. Pincer/reflection dynamics learning and a held-out dynamics split are not implemented. The explicit `temporal` suite preserves foundational v0.4 published-rule state reconstruction. Earlier planning and reservation experiments remain explicitly legacy. Keep research claims proportional to the evidence.

## Run and verify

- Node.js 22 or later; there are no external runtime dependencies.
- Start the local workbench with `npm start` (default `http://127.0.0.1:4173`).
- Run `npm test` for engine, temporal-boundary, API, browser-render and model-adapter checks.
- Read `PROJECT_DIRECTION.md`, `README.md`, `RESEARCH.md`, and `CLOUD_HANDOFF.md` before changing experimental semantics.
- Read `BENCHMARK.md` for v0.5 dynamics tasks, prediction-only scoring, automatic calibration steps and schema-4 reports. `evaluate` defaults to dynamics; `validate` crosses inferred/provided rules with base/changed timing. Explicit `--suite temporal` retains foundational timestamp/noise controls.
- Preserve explicit `--suite legacy` reproduction of the six earlier tasks and eight-condition matrix. `benchmark` retains the original simulator batch behavior. `node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2` remains the mechanism demonstration.

## Architecture

- `engine/index.js`: original seeded simulator transitions, immutable snapshots, backward evidence walk, replay, feedback delivery and orchestration.
- `engine/scenarios.js`: original scenario descriptions, checkpoints and actions.
- `model.mjs`: server-only structured model adapter; never import into browser code.
- `model-client.mjs`: shared server-only Responses/compatible transport and local schema validation.
- `benchmark/`: dynamics generators keep hidden mechanisms, expected futures and audit hooks evaluator-only. The reference learner must infer from public calibration evidence, never hidden generator parameters.
- `benchmark/temporal-tasks.mjs`: focused historical-state and revision generators, with evaluator-only answer closures and audit hooks.
- `benchmark/`: strategy orchestration, scoring, replay, legacy generators and versioned reports; never serve evaluator modules to browsers.
- `benchmark/validation.mjs`: suite-specific fixed timing/mechanism or timestamp/noise conditions, descriptive deltas and complete/error coverage. Legacy validation is preserved separately.
- `server.mjs` and `cli.mjs`: shared validation/execution and local HTTP/CLI interfaces.
- `public/`: responsive workbench in plain HTML, CSS and JavaScript; saved reports remain readable locally.
- `tests/`: Node built-in runner; no network-provider or paid API calls.

## Core direction for future work

- Every new primary task must state how it tests learning system dynamics or predicting a fresh future. Explanation-only tasks, evidence timing and timestamp puzzles are secondary/supporting diagnostics, not the central research question.
- Learn mechanisms from observed episodes; include a mechanism-supplied control to separate learning from applying a known rule. Test new event compositions, intervals or interventions, rather than only new labels.
- Assess learning primarily through predictive transfer and mechanism-supplied controls; do not require a written explanation or mechanism declaration for primary prediction credit. Optional explanation diagnostics must use checkable states, mechanism commitments or counterfactual consequences, with separate scores. Do not combine them with prediction into a headline score requiring both. Fluent retrospective prose alone is not evidence of understanding.
- Preserve ambiguity when multiple mechanisms or histories fit the observations. Do not grade solely against a secretly sampled history that cannot be identified from the evidence.
- Freeze future predictions before revealing the evaluated continuation. Same-instance recovery after seeing the outcome is not forecasting; evaluate transferred lessons on fresh futures.
- Keep pincer optional and compare it with competent forward and reflection methods under declared evidence and compute budgets. A tie or negative result remains valid.
- Preserve v0.5 as a distinct protocol. Never relabel v0.4 or legacy results as evidence for dynamics learning. Dynamics supports only the actual public development template; do not invent an evaluation split. No paid model calls belong in routine verification.

## Current protocol and research invariants

- The default dynamics suite scores fresh predictions only and forbids same-instance retries or analyzed recovery. The explicit foundational temporal suite preserves v0.4 temporal state reasoning. Planning, resource optimization and reservation arithmetic belong to the explicit legacy suite. Its scoring contract remains separate from the implemented dynamics task.
- In current deterministic matched tasks, preserve non-temporal facts/options while a timestamp-only perturbation changes at least one correct answer. Irrelevant observations must leave correct answers unchanged. Preserve generator clock-translation invariance tests; do not call them model-invariance evidence. Future stochastic tasks must test changed oracle distributions rather than require realized-outcome flips.
- Current v0.4 outcomes are unassisted first-attempt accuracy/success and correctness on both members of required temporal answer flips. Assisted recovery is secondary and scored separately; these are not yet dynamics-learning or future-prediction scores.
- Default agents are deterministic reference fixtures. Never present their results as evidence of language-model ability or superiority.
- Share the same physical first-attempt source across comparison modes, cloning data independently. Shared strategy rows are not independent trials.
- Keep hidden parameters, answer keys, future records and evaluator audit hooks outside actor and analyst contexts, including nested snapshots. Do not serialize expected answer labels in temporal audits.
- Reflection and pincer receive the same completed observable evidence and bounded replay budget.
- Pincer packets reach only their semantic checkpoint on a later attempt; a first attempt never sees its own future.
- Verify proposals with fixed-seed, single-decision replay, holding all other recorded actions fixed. Preserve rejected proposals too.
- Removing one failure need not make the whole task succeed. Report forward execution and replay costs separately.
- A tie with ordinary reflection is valid. Separate traversal-order and delivery-timing ablations before claiming which mechanism helps.
- Execute forced single-option steps automatically for all benchmark policies; preserve their normal effort, observations and history, and report automatic versus policy counts. Do not silently pool v0.2, v0.3, v0.4, v0.5 or legacy protocols.
- Keep public development/evaluation splits distinct from a genuinely untouched held-out study. Incomplete matched pairs have null individual deltas and explicit error/coverage counts. Paired temporal accuracy requires both answers correct, not merely different.
- Legacy delayed-family choices precede changed probe timing and distractors. Treat their first-pass comparisons as negative controls; identical permitted prompts do not test temporal anticipation.
- Do not claim temporal QA/state tracking are novel or unique based on these two templates. No automatic significance or mechanism-advantage claims.

## Credentials and generated output

- Never commit API keys, `.env` files or private user data.
- Live-model calls require explicitly configured server credentials and incur charges on hosted providers; do not run paid experiments as routine verification.
- Generated result JSON and local logs are ignored. Do not weaken exclusions to publish a run.
- Preserve localhost binding and same-origin request checks unless remote serving is explicitly requested and access controls are designed.
