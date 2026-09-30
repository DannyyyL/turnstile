# Turnstile research protocol

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
