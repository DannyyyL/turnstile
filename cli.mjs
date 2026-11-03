#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, execute, publicError } from './server.mjs';

const HELP = `Turnstile — model-neutral temporal reasoning benchmark

Usage:
  node cli.mjs evaluate [options]
  node cli.mjs validate [options]
  node cli.mjs matched [--task delayed_commit|coupled_commit|coupled_feedback] [--condition infer|given|ablated]
  node cli.mjs tasks

Options:
  --seed <integer>      Starting environment seed (default 42)
  --attempts <1..5>     Dynamics requires 1; historical suites allow recovery
  --seeds <1..50>       Paired seed count (default 1; live maximum 3)
  --policy <kind>       reference (offline), openai, or compatible (evaluate/validate/matched)
  --model <name>        Override the configured model identifier
  --analysis-budget N  Counterfactual replay limit per analyzed mode (default 24)
  --output <file.json>  Write the full reproducible result; otherwise prints JSON
  --suite <id>         dynamics (default), temporal (foundation), or legacy
  --task <id>          Task identifier (evaluate/matched)
  --pairs <ids>        Comma-separated 1-based pair IDs (matched only, default all)
  --family <id>        Filter the selected suite's task family (evaluate only)
  --variant <id>       base (default) or temporal_shift
  --rule-access <id>   infer (default) or given-mechanism control (value: given)
  --strategies <ids>   Dynamics requires forward_only; historical recovery optional
  --split <id>         development (default), evaluation, or all (evaluate only)
  --interference N    Irrelevant observations per forced step, 0..3 (default 0)
  --help               Show this help

Legacy experiments (preserved for reproduction):
  node cli.mjs evaluate --suite legacy [options]
  node cli.mjs validate --suite legacy [options]
  node cli.mjs compare [options]
  node cli.mjs run --mode temporal_pincer [options]
  node cli.mjs benchmark --seeds 10 [options]
  node cli.mjs scenarios
  --scenario <id>      Original simulator scenario (default webhook_release)
  --mode <id>          forward_only, reflection, or temporal_pincer (run only)
  --delay <0..7>       Legacy consequence delay (default 7)
  --state-mode <id>    Legacy temporal (default) or updates control
Legacy evaluate defaults to two attempts and all four strategies.
An explicit legacy task ID selects its legacy suite automatically.

Live mode reads OPENAI_API_KEY from the environment; it never accepts a browser key.
Live batches are limited to 3 seeds. No model calls are made in reference mode.
evaluate uses the v0.5 dynamics-learning task; benchmark retains the original simulator batch.
Dynamics uses three observed calibration runs and scores only unseen-run forecasts.
It permits no retry after seeing the evaluated future. The temporal suite preserves
the v0.4 historical-state diagnostics and their separate recovery experiments.
validate defaults to four dynamics conditions: infer/given rules crossed with timing.
matched tests eight mechanism pairs; each live condition uses up to 96 calls.
The legacy validation matrix has eight conditions. Validation fixes its variants;
use evaluate --variant temporal_shift to select a single perturbed task.
Compatible endpoints read TURNSTILE_BASE_URL, TURNSTILE_MODEL, and optional
TURNSTILE_API_KEY from the server environment. They may be hosted or local.
`;

export function parseArgs(argv) {
  const [command = 'evaluate', ...args] = argv;
  if (command === '--help' || command === '-h') return { help: true };
  if (!['run', 'compare', 'benchmark', 'scenarios', 'evaluate', 'validate', 'matched', 'tasks'].includes(command)) throw new Error('Unknown command. Use --help for usage.');
  const names = {
    scenario: 'scenarioId', seed: 'seed', attempts: 'attempts', mode: 'mode', seeds: 'seedCount',
    policy: 'policyKind', 'policy-kind': 'policyKind', model: 'model', 'analysis-budget': 'analysisBudget', output: 'output',
    task: 'taskId', family: 'family', delay: 'delay', strategies: 'strategies', condition: 'condition', pairs: 'pairIds',
    split: 'split', 'state-mode': 'stateMode', interference: 'interference', suite: 'suite', variant: 'variant', 'rule-access': 'ruleAccess',
  };
  const numeric = new Set(['seed', 'attempts', 'seedCount', 'analysisBudget', 'delay', 'interference']);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--help' || args[index] === '-h') return { help: true };
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[index]);
    if (!match || !names[match[1]]) throw new Error('Unknown option. Use --help for usage.');
    const name = names[match[1]];
    if (Object.hasOwn(options, name)) throw new Error(`Option --${match[1]} was provided more than once.`);
    const raw = match[2] ?? args[++index];
    if (raw === undefined || raw === '' || raw.startsWith('--')) throw new Error(`Option --${match[1]} requires a value.`);
    if (numeric.has(name) && !/^\d+$/.test(raw)) throw new Error(`Option --${match[1]} requires a nonnegative integer.`);
    if (name === 'pairIds') {
      if (command !== 'matched') throw new Error('--pairs applies only to matched.');
      if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(raw)) throw new Error('--pairs requires comma-separated positive integers.');
      options[name] = raw.split(',').map(Number);
    } else {
      options[name] = name === 'strategies' ? raw.split(',') : numeric.has(name) ? Number(raw) : raw;
    }
  }
  const output = options.output;
  delete options.output;
  if (command !== 'run' && options.mode) throw new Error('--mode applies only to run.');
  if (command === 'run' && Object.hasOwn(options, 'seedCount')) throw new Error('--seeds applies only to compare or benchmark.');
  if (['scenarios', 'tasks'].includes(command) && Object.keys(options).length) throw new Error(`${command} does not accept experiment options.`);
  return { operation: command === 'compare' && Object.hasOwn(options, 'seedCount') ? 'benchmark' : command, options, output };
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  if (parsed.help) { console.log(HELP); return; }
  try {
    if (parsed.output) {
      try {
        await access(path.resolve(parsed.output));
        const exists = new Error('Output already exists.');
        exists.code = 'EEXIST';
        throw exists;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const result = parsed.operation === 'scenarios' ? config() : parsed.operation === 'tasks' ? config().benchmark : await execute(parsed.operation, parsed.options);
    const data = `${JSON.stringify(result, null, 2)}\n`;
    if (parsed.output) {
      const outputPath = path.resolve(parsed.output);
      await writeFile(outputPath, data, { flag: 'wx' });
      console.log(`Saved ${parsed.operation} result to ${outputPath}`);
    } else console.log(data.trimEnd());
    if (result.status === 'completed_with_errors') process.exitCode = 1;
  } catch (error) {
    if (error.code === 'EEXIST') console.error('The output file already exists. Choose a new path to preserve previous results.');
    else if (['EACCES', 'ENOENT', 'EISDIR'].includes(error.code)) console.error('The result could not be saved. Choose an existing writable directory and a new JSON filename.');
    else console.error(publicError(error).error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
