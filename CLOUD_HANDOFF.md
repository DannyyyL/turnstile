# Turnstile: cloud continuation handover

## Product and research objective

Build a modern multi-agent experiment framework inspired by temporal pincer movements. A forward agent produces an observation/action/state trajectory. An inverted agent starts from the observed final outcome, follows the completed trajectory backward, attributes delayed failures to earlier decisions, and sends targeted future-derived information to matching checkpoints on a subsequent attempt.

Compare forward-only agents, ordinary end-of-run reflection, and temporal-pincer agents. The user's longer-term interests include coding agents, debugging, planning, and robotics/autonomy environments. The first version should be meaningful and agentic, rather than maze/pathfinding work.

## What is implemented

- Two seeded, 16-checkpoint simulated engineering workflows: webhook service release and account-identifier database migration.
- Eight early configuration decisions, followed by build/staging/pilot and delayed integration checks.
- A genuine backward artifact-evidence walk, ambiguous provenance candidates, and single-decision counterfactual replay.
- Checkpoint-specific packets on later attempts; ordinary reflection receives all verified notes at attempt start.
- Fair paired comparison using one shared initial trajectory and equal analyst replay limits.
- A local responsive browser workbench with experiment, trajectory, comparison, and protocol views, plus JSON download controls.
- A zero-dependency Node server, CLI, and optional live-model adapter with validated structured responses and no silent reference fallback.
- Research protocol and 29 passing automated tests at initial handover.

## Reproduce the demo

```sh
node --version
npm test
node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2
npm start
```

No package installation is needed. For a multi-seed export, choose an existing writable directory and a new filename:

```sh
node cli.mjs compare --scenario webhook_release --seed 42 --attempts 2 --seeds 12 --output /tmp/turnstile-reference.json
```

Seed 42 starts with seven delayed webhook failures. The retry choice at T=3 contributes to a throttling failure at T=13. The reference forward-only policy repeats its failure; reflection and pincer both repair the task on attempt two. A paired demonstration over seeds 42–53 yielded 0/12 final successes for forward-only and 12/12 for both feedback modes. These are reference-policy mechanism results, not AI efficacy evidence.

## Important limits

The environment uses simulated tools, not a real code repository or deployment. The cheap greedy reference policy deliberately produces a reproducible failed trace. Higher-effort robust options are globally safe, and there is no hard engineering-effort budget; a capable model could choose them all immediately. Provenance instrumentation also makes attribution easier than real-world logs.

The main comparison mixes backward traversal and delivery timing. It does not isolate either effect. Replay validates local failure removal under a fixed later action sequence, not unique causation or real-world causal certainty. The forward-only control is a fresh retry without memory; stronger memory and compute controls remain future work.

Actual live-model calls have not been verified. Adapter tests use mocked provider responses. Configure `OPENAI_API_KEY` as a cloud environment secret and optionally `OPENAI_MODEL` before explicitly requesting live experiments. Do not put credentials in prompts, code, or artifacts.

## Sensible next research work

1. Add a budget and inspection tools with meaningful tradeoffs, including successful first attempts and negative controls.
2. Add a 2×2 ablation: forward/reverse analysis order crossed with start/checkpoint feedback delivery, holding evidence cards constant for timing comparisons.
3. Evaluate live agents with paired source traces, repeated trials, token/effort accounting, and held-out cases.
4. Introduce an environment interface for disposable coding workspaces: capture diffs and test output, reset cleanly, and match semantic decision points across changed trajectories.

Ask the user which of these they want next before initiating a substantial new research direction. They prefer direct action once scope is clear and do not want repeated permission questions for already-authorized work.

## Cloud and preview details

The original workbench runs on the user's Windows PC at localhost. It does not migrate with the GitHub files. Start a new server in the cloud environment and use its supported preview mechanism. The server intentionally accepts loopback hosts and same-origin requests; a proxy may require deliberate compatibility work. Do not blindly bind publicly or remove origin checks to make a preview work.

Generated result files, preview screenshots, ZIP downloads, credentials, and synced ChatGPT project reference files are not part of the repository. The source and reproducible commands are sufficient to regenerate demo results.
