# Turnstile research protocol

## Core research question

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?**

This is the project's accepted direction. [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md) is the durable charter for future work. The primary target is learning dynamics from observations and testing predictive transfer across fresh episodes. Explaining the past is a secondary, checkable diagnostic, not a coequal goal or prerequisite for prediction credit. Temporal bookkeeping and evidence-arrival controls support that target; they are not the central research contribution. Pincer remains one strategy to evaluate, with no presumed advantage.

Version 0.5 now implements the first small task combining observed calibration runs, a mechanism-supplied control and predictions committed before fresh outcomes are revealed. Primary evaluation measures future-prediction quality and learning/transfer. Optional past reconstruction or explanation diagnostics should help identify learned mechanisms or forecast errors and have separate scores. Learning need not require a written explanation. Handle multiple mechanisms consistent with the evidence honestly; a compelling account of a completed trace cannot substitute for predictive performance on a fresh future.

The default v0.5 `dynamics` suite contains one public development template, `delayed_commit`. Three calibration runs support inference of a hidden delay and repeated-input behavior; six fresh-run categorical predictions are scored. The `given` control supplies the mechanism. Only one unassisted attempt is permitted, preventing a previously revealed continuation from being credited as an unseen prediction. No pincer/reflection dynamics-learning strategy, probabilistic forecast evaluation or held-out dynamics split is implemented yet. No paid model evaluation of this task has run.

The separate CLI matched pilot includes `coupled_commit`, which forecasts the joint state of two interacting delayed processes. The pilot holds future inputs and query times fixed within each pair and measures correctness on both sides of mechanism-induced answer changes. Compare it with the supplied-rule and calibration-ablated conditions before interpreting model errors. See [BENCHMARK.md](BENCHMARK.md#matched-mechanism-pilot).

The v0.4 state-reconstruction semantics below remain available under `suite: temporal`; their published-rule queries and optional same-instance recovery retain their foundational interpretation. Do not relabel these or older pilot results as dynamics-learning evidence.

## Foundational temporal suite (preserved v0.4 semantics)

The foundational temporal suite is a narrow diagnostic of **effective-time versus received-time state reconstruction**. `temporal_history` asks which assignment applied at a queried past time using records known at each query. `temporal_revision` asks about the same past time as late assignments and retractions change what is known. No planning, resource optimization, reservation arithmetic or expiry is part of these two tasks. [BENCHMARK.md](BENCHMARK.md) defines their executable protocol.

Correctness on both members of answer-changing timestamp pairs is the primary temporal diagnostic. Unassisted first-attempt query accuracy and complete-task success are also reported, but timestamp-blind shortcuts can score highly on individual fixed-template questions; those metrics alone are insufficient. Optional trace memory, ordinary reflection and temporal-pincer recovery are secondary experiments. Successful initial reasoning earns full task credit; a benchmark must not require a first-attempt failure to reward an assistance mechanism.

Temporal QA, temporal knowledge bases and state tracking are established research areas. These tasks are not claimed to be unprecedented or uniquely temporal. Their inclusion criterion is operational: preserving all non-temporal facts and choices while changing temporal metadata must change at least one expected answer. Irrelevant maintenance observations must preserve every answer. This is stronger than calling a planning task temporal merely because its decisions occur in sequence; it is still a small acceptance check, not a complete construct-validity argument.

## Foundational controls and limits

The four-condition matrix crosses base/changed effective timestamps with clean/distracted observations. The evaluator audits that exactly one effective timestamp differs, non-temporal facts/options remain fixed, and a required answer flip exists. It reports changed query IDs and counts without leaking answer labels to actors or analysts.

Paired temporal accuracy awards credit only when both unassisted answers are correct at a required flip. An agent that repeats the same answer or changes to another wrong answer receives no credit for that query. Noise controls preserve correct answers and expose performance under irrelevant context. Deltas alone are insufficient: equally low scores can hide different mistakes. Incomplete pairs have null paired metrics and remain in error/coverage counts.

Uniform clock translation is unit-tested at the generator level: translating effective, received and query clocks together preserves answers and action order for both tasks and variants. No model offset-invariance experiment has been run. Future evaluation should also vary temporal relationships, language and event structures independently of familiar labels, and test model invariance under harmless clock changes.

There are only two public templates. Seeds randomize labels and option order, not domains or underlying solution structures. Some individual questions are controls or bookkeeping steps rather than standalone proofs of temporal dependence. The public evaluation template was developed alongside the harness; it is not an untouched held-out test. A schema/version change and automated tests do not establish benchmark validity or model difficulty. No paid model evaluation of v0.4 has been performed.

Forced single-option records execute automatically for every policy while remaining in subsequent history. Four query decisions remain policy choices. Record automatic actions, policy choices, replay costs and actual model requests separately. The default deterministic policy intentionally supplies a reproducible fixture; its score is no evidence about language models.

Four strategy rows sharing one source trajectory are not independent first-attempt trials. Fresh unassisted sources in different matched conditions are independent model calls even when environment seeds match; a seed does not control provider randomness. Overlapping pair summaries must not be pooled as independent observations. Report incomplete/error coverage and avoid automatic significance, ranking or causal-advantage claims.

Reflection and pincer use identical completed observable evidence and replay budgets. Pincer is previous-attempt knowledge delivered later at a matching checkpoint, never information from the future of an actor's own first attempt. The main comparison combines traversal order and delivery timing, and total compute is unequal across strategies. A tie with ordinary reflection is valid. Test identical-card delivery timing separately from analyst traversal before attributing an effect to either component.

## Independent evaluation of the current v0.4 diagnostic

Before a stronger model study of the current diagnostic (the dynamics-learning milestone is specified separately in [PROJECT_DIRECTION.md](PROJECT_DIRECTION.md)):

1. Freeze task semantics, prompts, graders, output/error policy, sampling settings and fingerprints.
2. Create independently authored temporal structures and solution patterns outside prompt tuning. New seeds or renamed entities alone are insufficient.
3. Specify primary temporal contrasts, repeated trials, budgets, stopping rules and missing-data treatment in advance.
4. Keep genuinely held-out cases out of tuning. Record inspection or later changes as departures rather than silently redefining the test set.
5. Report every selected case and trial, uncertainty, errors, paired answer behavior and actual costs. Separate unassisted temporal ability from assisted recovery.

This is a future study plan, not a claim that preregistration or independent held-out validation has occurred.

## Preserved historical research

The v0.2/v0.3 six-task suite is retained explicitly under `suite: legacy`. Planning and reservation arithmetic no longer contribute to focused scores. [VALIDATION_REPORT.md](VALIDATION_REPORT.md) records the bounded **historical v0.3** OpenRouter pilot, not performance evidence for the new tasks. Its recovery ties and errors must remain visible. The v0.2 local Ollama smoke also used historical tasks and a different protocol.

Legacy delayed-task choices all precede the changed late probes and distractions. Their first-attempt matched prompts are identical for a fixed instance, so first-pass differences are negative controls, not delay-sensitive anticipation. Later evidence can affect completed-trace diagnosis and recovery. Legacy updates controls preserve effective-time reasoning and are not atemporal baselines.

The remainder is the original v0.1 simulator research protocol. It is preserved as background for `/demo.html`, [WORKBENCH.md](WORKBENCH.md) and the legacy mechanism demonstration. Its proposals about planning extensions, globally safe choices, resource constraints and coding-agent environments are historical research directions, not requirements or claims of the focused v0.4 benchmark.
Turnstile studies whether traversing a failed agent trajectory backward improves credit assignment, and whether delivering the resulting evidence at an earlier decision improves a subsequent attempt. The first version is an instrumented software-release planning environment: an agent uses tools to inspect requirements, choose changes, validate a release, and ship. Early choices can create incompatibilities that only appear during later integration or production-readiness checks.

This is information learned from a completed attempt and reused in a new attempt. A forward agent never receives information from the future of its own first attempt.

## What the vertical slice establishes

The release environment supplies a reproducible delayed-consequence failure, an ordered trajectory, a backward diagnosis, a targeted intervention, and a successful or failed replay. A deterministic reference policy makes the mechanism inspectable and runnable without an API key. It does **not** establish that language models reason better backward, or that targeted delivery beats a capable reflection baseline.

Keep the demonstration and any learned-agent evaluation separate. If a diagnosis or policy contains handwritten scenario-specific rules, label it explicitly. A scripted baseline that ignores useful criticism can illustrate a delivery mechanism but cannot support an effectiveness claim.

The release simulator can expose producer or artifact provenance in late check results to make candidate discovery observable. This is useful instrumentation, but it makes diagnosis easier than reading unstructured real-world logs. Provenance identifies a candidate earlier action; it does not by itself verify that the action caused the failure.

Raw failure observations expose candidate artifact origins and probe evidence, without the evaluator's exact causal source or a prewritten explanation. The reference backward analyst walks recorded checkpoints from latest to earliest, adds failures to an evidence frontier at their detection checkpoints, and follows candidate producer links when it reaches earlier decisions. Its displayed reverse walk is an instrumented algorithm trace, not a language model's private reasoning.

Current scenarios offer higher-effort robust choices that are globally safe, with no hard execution-effort limit. A capable forward model can plausibly choose them all and succeed immediately. The cheap greedy reference policy deliberately supplies a reproducible failed trace; its failures do not establish that those choices were difficult or that late evidence was necessary. Add explicit resource constraints, optional inspections, and competing viable strategies before treating this environment as a challenging planning benchmark.

## Information boundaries

- The acting agent sees only the initial brief, its own tool observations, and assistance permitted by its experimental condition. Environment internals and success checks stay outside the agent context.
- Both post-run analysts receive the **same complete failed trajectory**, including action arguments, results, timestamps or steps, and the final outcome. The ordinary critic must be allowed to identify early causes and provide concrete remedies.
- A backward analyst starts at the final observation and walks through earlier observations. Reversing the serialized order alone is not evidence of backward reasoning: record the analyst's examined steps, dependency links, and selected earlier decisions.
- Assistance cites evidence that existed in the completed trajectory. Do not grant one analyst a hidden dependency graph, environment truth, an answer key, counterfactual results, or additional tool access.
- The second attempt starts from the same environment snapshot and exogenous seed. The final outcome of the first attempt is legitimate prior-attempt information; a later result from the second attempt is not.
- Keep run identifiers, scenario labels that encode the solution, and success-check implementation details out of prompts. Store them separately for evaluation.

When an implementation uses an oracle for diagnosis or replay, treat it as evaluator instrumentation. Do not silently present its knowledge as agent-discovered evidence.

## Experimental conditions

Use paired runs from an identical first-attempt trace whenever measuring reflection versus temporal assistance. Independently generated first attempts introduce a separate exploration effect.

| Condition | Post-run process | Assistance on the next attempt |
| --- | --- | --- |
| Forward only | No post-run analyst | Agent's ordinary observations and permitted prior-attempt memory |
| Ordinary reflection | Critic reads the complete trajectory | Entire reflection available from the start |
| Temporal pincer | Analyst traverses the same trajectory backward | Evidence cards delivered immediately before their matched earlier decisions |

The forward-only memory rule must be explicit. A strictly fresh baseline isolates memory, while a baseline allowed to keep its own previous trace is a stronger practical control. Include both before claiming a general advantage.

Match model, sampling settings, context limits, analyst token budget, number of environment attempts, and acting-agent tool budget. Report actual tokens and tool calls as well as limits. A forward-only condition can spend the analyst's allocation on additional forward deliberation; otherwise any gain may come from extra compute. Never silently charge targeted notes outside the context budget.

Two comparisons isolate different hypotheses:

1. **Credit assignment:** forward-order critic versus backward-order analyst, with the same evidence, output schema, output-token budget, and assistance delivery method.
2. **Delivery timing:** exactly the same evidence cards shown at the start versus delivered at matched decision points. This controls for information quality.

The three main conditions mix those effects. They are useful as a product comparison, but do not identify which mechanism caused a difference.

## Evidence cards and causal validation

A useful evidence card records a target decision, the earlier action and result, the later observation, an explicit hypothesized dependency, a suggested intervention, and uncertainty. Prefer semantic checkpoints, such as `choose_schema` before commitment, over absolute step numbers: the next trajectory may contain extra inspections and a different sequence.

Evidence should follow a chain that a reviewer can inspect:

`earlier action -> affected release artifact or dependency -> later failing check -> proposed change`

Temporal order and a plausible explanation alone do not establish causality. Replay from the same initial snapshot with a minimal intervention at the selected decision and record the result. A replay can demonstrate causality **inside this deterministic environment** when other inputs are held fixed; it does not establish causality in real software releases. Also replay an irrelevant intervention or a change at an unrelated decision as a negative control. Preserve unsuccessful interventions instead of selecting only convincing examples.

Counterfactual validation belongs to the evaluator unless both analysts receive the same replay budget. Record which conclusions came from observed evidence and which were checked by evaluator replay. Some failures have multiple interacting causes; allow multiple cards and avoid forcing a single-cause explanation.

For simulator replay, hold the seed and recorded later action sequence fixed. Record the replacement action, number of replayed actions, and replay outcome. If only the selected late failure disappears, call the intervention locally verified; a different remaining defect can still prevent the release from succeeding. Do not conflate local defect removal with final task success.

## Measurements

| Measurement | Purpose |
| --- | --- |
| Final release success across all attempts | Main task outcome |
| Attempts, actions, and tokens to success | Total cost of recovery |
| First wrong decision to first revealing observation, in steps | Size of the delayed-consequence problem |
| Correct early decisions on the next attempt | Whether assistance changed the intended action |
| Supported causal links and replay-validated interventions | Quality of credit assignment |
| Wrong or unsupported cards | Risk of misleading assistance |
| Cards delivered, consulted, and obeyed | Whether the delivery mechanism was actually used |
| Intervention timing and checkpoint-match failures | Robustness when trajectories change |

Separate task success from analyst accuracy. A good diagnosis can be ignored, and a successful run can result from an unrelated change. Record both. Do not describe a single scripted run or one scenario as a benchmark win.

## Evaluation beyond the demonstration

Create held-out release scenarios with several delayed dependencies, distractor warnings, harmless early choices, differing correct solutions, and failures revealed at different stages. Some scenarios should be solvable through careful initial inspection; others should require information first revealed after execution. Include successful first attempts and cases where the late failure has no repairable earlier decision.

Randomize equivalent action labels and tool-result wording to reduce memorization of reference rules. Separate scenario construction, prompt development, and held-out evaluation. Use paired seeds and multiple runs; report per-scenario results and uncertainty, including failures. The evaluator should identify a valid outcome without exposing its solution to agents.

Useful ablations include backward versus forward traversal, targeted versus start-of-run delivery using identical cards, complete trace versus final-outcome-only criticism, randomly timed cards, cards with causal links removed, and ordinary criticism with explicit early-decision diagnosis instructions. A strong critic may match the pincer agent; that is an informative result.

## Extension to coding agents

Replace release actions with repository tools and a disposable checkout: inspect files, edit, run tests, inspect logs, and submit a patch. Record each tool observation and patch as an immutable event. Start recovery attempts from the same repository commit. Target evidence to a semantic operation or affected symbol rather than an exact step index. Test delayed dependencies such as a schema change that passes unit tests but breaks integration, a cache-key omission revealed after a later deployment, or a refactor that invalidates a downstream assumption.

Keep original failures, full diffs, tool costs, replay results, and analyst outputs. Provide a pluggable acting-agent and analyst interface so the deterministic demo can be replaced by model-backed agents without changing the environment or scoring. Progress to stochastic simulations only after reset, replay, and evidence provenance are reliable.
