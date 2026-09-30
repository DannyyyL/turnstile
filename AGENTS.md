# Turnstile development instructions

Turnstile is an experimental framework for temporal-pincer agent reasoning. Keep research claims proportional to the evidence.

## Run and verify

- Node.js 22 or later; there are no external runtime dependencies.
- Start the local workbench with `npm start` (default `http://127.0.0.1:4173`).
- Run `npm test` for engine, research-boundary, API, and model-adapter checks.
- Use `node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2` for the reproducible mechanism demonstration.
- Read `README.md`, `RESEARCH.md`, and `CLOUD_HANDOFF.md` before changing experimental semantics.

## Architecture

- `engine/index.js`: seeded transitions, immutable trajectory snapshots, backward evidence walk, counterfactual replay, feedback delivery, experiment orchestration.
- `engine/scenarios.js`: scenario descriptions, checkpoints, and available actions.
- `model.mjs`: server-only structured model adapter; never import it into browser code.
- `server.mjs` and `cli.mjs`: shared validation/execution and local HTTP/CLI interfaces.
- `public/`: responsive workbench in plain HTML, CSS, and JavaScript.
- `tests/`: Node built-in test runner; no network or paid API calls in tests.

## Research invariants

- Default agents are deterministic reference policies. Never present their results as evidence of language-model superiority.
- Share the same first-attempt source trajectory across comparison modes, but clone its data independently.
- Keep hidden workload parameters and evaluator-known causal answers outside acting and analyst contexts, including nested snapshots.
- Reflection and pincer receive the same completed observable evidence and bounded replay budget.
- Pincer packets reach only their semantic checkpoint on a later attempt; a first attempt never sees its own future.
- Verify causal proposals with fixed-seed, single-decision replay, holding all other recorded actions fixed. Preserve rejected proposals too.
- Removing one failure does not mean the whole task succeeds. Report forward execution and replay costs separately.
- A tie with ordinary reflection is a valid result. Separate traversal-order and delivery-timing ablations before claiming which mechanism helps.

## Credentials and generated output

- Never commit API keys, `.env` files, or private user data.
- Live-model calls require explicitly configured server credentials and incur API charges; do not run paid experiments as routine verification.
- Generated result JSON and local logs are ignored. Do not weaken these exclusions to publish a run.
- Preserve the existing localhost binding and same-origin request checks unless remote serving is explicitly requested and access controls are designed.
