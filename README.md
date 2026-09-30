# Turnstile

Turnstile is a local experiment workbench for temporal-pincer agent systems. A forward agent completes a software-release planning task, a second process diagnoses its completed trajectory, and a fresh forward attempt receives information learned from that earlier attempt.

The first vertical slice is a bounded engineering environment: a webhook-service release and an account-identifier migration. Each has eight early design decisions followed by build, staging, smoke tests, and delayed integration gates. A healthy pilot can hide an event-loss bug, a tenant-identity collision, a compatibility break, or an unsafe rollback. The environment records actions, observations, artifact provenance, costs, and outcomes, allowing a late failure to be connected to an earlier decision.

This is a simulated software-release environment with structured tool actions. It does not edit a real repository, deploy a service, or run a physical robot.

## Run locally

Use Node.js 22 or later. There are no npm dependencies and no installation step.

```powershell
cd turnstile
npm start
```

Open [the local workbench](http://127.0.0.1:4173). It binds to `127.0.0.1`; use `PORT` to select another local port. The browser workbench supports paired comparisons, trajectory inspection, evidence cards, multiple-seed batches, and JSON export. System fonts keep the interface usable offline; the browser can load Google Fonts when available.

```powershell
npm test
node cli.mjs scenarios
node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2
node cli.mjs run --scenario database_migration --mode temporal_pincer --seed 42 --attempts 2
node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2 --seeds 10 --output results.json
```

`--seeds 10` runs ten paired comparisons using consecutive seeds beginning at `--seed`. The `benchmark` command is equivalent. `--output` saves full traces and aggregate results, and refuses to overwrite an existing result file. Use a new filename for another run. Reference runs are reproducible given the same options and code. A seed controls environment conditions; it does not make live model calls deterministic.

## Three conditions

| Condition | Analysis | Information on the next attempt |
| --- | --- | --- |
| `forward_only` | None | Fresh start; no previous-run feedback |
| `reflection` | Ordinary complete-trajectory criticism | All verified repair notes available at attempt start |
| `temporal_pincer` | Backward traversal from observed outcome toward earlier decisions | Verified notes delivered at matching decision checkpoints |

A comparison executes one first forward attempt and shares that exact source trajectory across all three conditions. All retries reset the same scenario and seed. Both analysts get the same observable completed trajectory, the same allowed intervention format, and the same replay budget. An ordinary critic is allowed to discover the same delayed causal relationships as the backward analyst. A tie is a valid result.

Reference mode uses **deterministic reference policies**, including a handwritten preference for low immediate cost and instrumented evidence analysis. These are not language-model agents. This mode demonstrates recording, diagnosis, counterfactual replay, and timed delivery; its scores cannot establish that backward reasoning improves AI performance. The interface and result metadata distinguish it from live model mode.

## Optional live model agents

Live mode uses separate structured model calls for forward decisions, ordinary criticism, and backward analysis. The backward analyst receives the same completed evidence in reverse order; its instruction asks it to connect late observations to earlier decisions. Recommendations are still validated by the environment before delivery. Failures, refusals, and incomplete responses stop the experiment instead of silently switching to reference policies.

Set credentials in the server's environment, then restart it. Never put a key in the browser or a saved result.

```powershell
$env:OPENAI_API_KEY = '<your API key>'
$env:OPENAI_MODEL = 'gpt-4.1-mini'
npm start
```

Select **Live model agents** in the workbench, or use the CLI:

```powershell
node cli.mjs compare --policy openai --model gpt-4.1-mini --attempts 2 --output live-result.json
```

`OPENAI_MODEL` supplies the default; `--model` overrides it. The example model is a configurable starting point, not a claim about the latest or best model. Your account must have access to a model supporting the Responses API and structured outputs. The adapter uses server-side `fetch`, `store: false`, strict JSON schemas, per-call timeouts, and explicit action validation. Its request structure follows [official text-generation documentation](https://developers.openai.com/api/docs/guides/text) and [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Live runs send their public scenario, observations, and trajectories to the model provider and incur API charges. A 16-step attempt can issue a decision call per step; comparisons add analyst calls and retries. The exported `modelUsage` records actual request counts and input/output tokens across the physical comparison. It does not estimate dollars or promise success. Start with one seed and two attempts. Use your provider account's spending controls.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | Local web-server port |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Live model identifier |
| `OPENAI_MAX_CALLS` | `300` | Hard model-request limit across an API/CLI operation |
| `OPENAI_MAX_OUTPUT_TOKENS` | `1200` | Equal per-call output limit, including both analysts |

The maximum is five forward attempts per condition, fifty reference seeds, or three live seeds. An API key enables live mode; reference mode makes no model calls. `.env` files are ignored by Git; the app does not automatically load them. Configure environment variables explicitly or use Node's own environment-file option. The web server rejects cross-origin requests and runs one experiment at a time.

## Evidence and future-information boundaries

The acting agent gets current observations, its own history, and assistance allowed by its condition. Hidden environment constraints and evaluator success rules stay outside model context. Analysts only read a **completed earlier attempt**. No first attempt receives information from its own future.

Late test output can name an affected artifact, allowing the analyst to propose an earlier change. Evaluator provenance is labeled as instrumentation. The evaluator replays the observed action sequence with one changed decision and holds scenario conditions fixed; it records whether that isolated intervention improves the outcome. These replay results establish a dependency only within this simulated environment. Replay is evaluation instrumentation and is charged separately from forward execution. Do not interpret replay knowledge as an independently discovered model insight.

The same visible trace and bounded counterfactual replay process support both reflection and temporal assistance. Targeted notes are delivered only at their original semantic decision checkpoint. Source evidence, diagnosis, proposed intervention, replay validation, and actual hint delivery can be inspected separately. A useful diagnosis does not imply that the forward agent followed it or succeeded.

## Reading results honestly

The main outcomes are final release success, attempts to success, decision-to-detection delay, action effort, counterfactual replay effort, and intervention delivery. Aggregate comparisons report paired seed success rates and costs; they do not attach unsupported significance or generalization claims. Abstract engineering effort is not money or model tokens.

The first version deliberately isolates a small, auditable mechanism. Its structured action space and early-decision ordering are much simpler than a coding agent's open-ended tools. The reference policy's fresh forward-only retry has no memory; a stronger baseline retaining its complete previous trace remains future work. Forward-only uses less analysis compute, so the three-condition comparison does not fully match total compute. Reflection and temporal-pincer analysis limits match, but actual token use can differ. The main conditions also combine analysis order with delivery timing, so they do not determine which factor caused an improvement.

For research claims, add held-out scenarios, stronger memory and compute controls, repeated model trials, uncertainty estimates, and the delivery-timing/traversal ablations in [the research protocol](RESEARCH.md). A capable forward agent may succeed on its first attempt, and a capable ordinary critic may match the pincer agent. Both outcomes are informative.

## Extend the framework

- Replace the reference policy with another acting policy and analyst implementation through the engine's policy hooks.
- Add release scenarios with new delayed dependencies, distractor observations, and negative controls.
- Adapt the environment to disposable repository checkouts: immutable file edits, test output, full diffs, and clean reset between attempts.
- Match hints to semantic tool operations or code symbols when trajectories can change order.
- Add independent backward-traversal and start-versus-checkpoint-delivery conditions before moving to robotics simulations.

`engine/` contains the environment, reference policies, and experiment orchestration. `model.mjs` is the server-only model adapter. `server.mjs` exposes `GET /api/config`, `POST /api/run`, `POST /api/compare`, and `POST /api/benchmark`. `cli.mjs` uses the same validation and execution helpers as the browser. `public/` contains the local research workbench. Node's built-in test runner checks experiment semantics, information boundaries, model-response validation, and the local API.

API requests use `{scenarioId, seed, attempts, policyKind}`; single runs additionally accept `mode`, and batches accept `seedCount`. Optional `model` and `analysisBudget` customize live model selection and the replay limit. API errors are structured and sanitized. Secrets and server source files are not browser-accessible.
