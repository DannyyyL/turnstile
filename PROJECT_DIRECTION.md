# Turnstile: core project direction

## The question

**Can a model learn the dynamics of an unfamiliar system well enough to predict an unseen future?**

This is the project's central research question, chosen and refined by the user on 2026-11-02. Learning dynamics and predicting unseen futures are the primary goals. Explaining the past is a secondary diagnostic. Use this priority to guide task design, experiments, website messaging and future development. This document records the accepted direction; the exact executable protocol for existing tasks remains in [BENCHMARK.md](BENCHMARK.md).

Turnstile is a model-neutral experimental benchmark. A model observes how an unfamiliar system evolves, learns its dynamics, and commits predictions about a fresh continuation or episode. The primary test is whether that learning transfers beyond the examples it has already seen: **Observe → Learn → Predict**.

## What the question means

- **Learn the dynamics:** infer rules governing change from observed episodes. Delays, persistence, cancellation, feedback and history dependence are candidate mechanisms. Elapsed time can change the system even when no new observation arrives.
- **Predict an unseen future:** commit an answer or predictive distribution before the evaluated continuation is revealed. Test fresh event compositions, intervals or interventions, rather than replaying an outcome the model has already seen.

A model can fit the past without learning a mechanism that transfers. Primary evaluation must therefore measure predictions on fresh sequences, timings or interventions. A mechanism-supplied control should distinguish difficulty learning a rule from difficulty applying its temporal consequences. Learning need not require a written explanation or an explicit mechanism declaration; evaluate it through predictive transfer and appropriate controls.

When the observations leave several mechanisms or histories possible, preserve that ambiguity. Accept consistent sets, underdetermination or calibrated probabilities as appropriate to the task contract. Do not reward guessing the evaluator's secret sampled history when multiple answers are consistent with the evidence.

## Secondary diagnostic: explaining the past

Checkable past explanations can help identify which rules a model learned or why its forecasts failed. When useful, ask for reconstructed states, mechanism hypotheses or counterfactual commitments that an executable evaluator can verify. Convincing retrospective prose alone earns no explanatory credit.

Report these diagnostics separately. They are optional supporting measurements, not a coequal project goal or a prerequisite for credit on correct future predictions. Do not combine past-explanation and prediction scores into a headline score that requires both. A task that only explains a completed history must be labelled secondary; it does not establish unseen-future prediction.

## Scope and decision rules

Before adding a task or feature, state how it supports learning dynamics or predicting unseen futures, and how its outputs will be checked. Label explanation-only work as a secondary diagnostic.

- Keep temporal dynamics causally relevant: changing event order, elapsed intervals or history should change what the system does where the mechanism requires it.
- Treat timestamp formatting, evidence-arrival bookkeeping, noise and clock shifts as controls or supporting diagnostics. They do not define the project's central capability.
- Keep generic planning, resource optimization and broad trivia outside the core. A task can use fixed inputs or interventions without asking the model to search for an optimal action plan.
- Remain model-neutral. Compare hosted and local models, simple temporal/statistical policies, ordinary reflection and other capable baselines on declared evidence and budgets.
- Temporal pincer is one evaluated strategy. It is neither the definition of success nor an assumed advantage. Backward reconstruction can be useful when it constrains mechanisms and improves new predictions; reverse presentation alone does not establish backward reasoning.
- Use exact executable graders where possible. Prioritize future-prediction quality and learning/transfer measurements. Report optional past-reconstruction or explanation diagnostics separately, including errors, ambiguity, coverage and actual costs.
- Preserve generator/held-out structural diversity. Renaming entities or shuffling answer positions alone does not establish transfer to unfamiliar dynamics.
- For deterministic contrasts, an appropriate timing change can require a different answer. For stochastic forecasts, require a meaningful change in the oracle distribution; realized outcomes need not differ.
- Keep information boundaries explicit. A forecast cannot see its evaluated future. Learning from resolved earlier episodes is legitimate when tested on a fresh, unseen future.

Existing temporal, causal and forecasting benchmarks are relevant prior art. The contribution must be demonstrated through useful measurements and evidence, without assuming this capability or its component methods are unprecedented. See [RELATED_WORK.md](RELATED_WORK.md).

## Current implementation and next evidence

Version 0.5 implements the first dynamics-learning task, `delayed_commit`, under the default `dynamics` suite. Three observed calibration runs identify a hidden deterministic mechanism; six categorical predictions test one fresh run. `ruleAccess: given` supplies the mechanism as a control. Prediction quality is primary; calibration observations earn no score. The task does not require explanations or explicit mechanism declarations for prediction credit.

This release permits one unassisted attempt with `forward_only`. It does not yet implement pincer, reflection or trace-memory dynamics learning, probabilistic forecasting, a held-out dynamics split, or real-world transfer. Same-instance recovery after seeing a resolved outcome cannot become unseen-future prediction. Future strategy work must transfer lessons to fresh futures.

The published-rule `temporal_history` and `temporal_revision` tasks remain foundational diagnostics under `suite: temporal`. Their optional recovery and the six earlier `legacy` tasks retain separate interpretations. Historical local/hosted pilots do not measure the new dynamics task. The coupled-task model pilot is documented in [BENCHMARK.md](BENCHMARK.md#evidence-and-limits).

The matched-mechanism pilot provides eight paired comparisons per task. Alongside the original delayed commitment pairs, `coupled_commit` asks for forecasts of two interacting delayed processes. The pilot asks whether forecasts change correctly when observations reveal a different mechanism under the same future input schedule. Report paired accuracy on answer flips alongside ordinary accuracy, coverage, a supplied-rule control, a calibration ablation and a fixed-state baseline. The calibration ablation deliberately removes identifying evidence and scores realized-state guesses separately from the main learning condition. See [BENCHMARK.md](BENCHMARK.md#matched-mechanism-pilot).

Next broaden the mechanism families, establish held-out structures and run repeated model trials. Checkable past diagnoses remain optional and separately scored. The matched tasks use public development pairs and provide descriptive results within each mechanism family.

Preserve existing changes and historical results. Do not silently redefine old protocols. Do not run paid model experiments without explicit approval.
