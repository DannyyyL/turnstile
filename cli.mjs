#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, execute, publicError } from './server.mjs';

const HELP = `Turnstile — temporal-pincer experiment workbench

Usage:
  node cli.mjs compare [options]
  node cli.mjs run --mode temporal_pincer [options]
  node cli.mjs benchmark --seeds 10 [options]
  node cli.mjs scenarios

Options:
  --scenario <id>       Scenario identifier (default webhook_release)
  --seed <integer>      Starting environment seed (default 42)
  --attempts <1..5>     Maximum forward attempts per mode (default 2)
  --mode <id>           forward_only, reflection, or temporal_pincer (run only)
  --seeds <1..50>       Paired seed count; compare also accepts this for batch mode
  --policy <kind>       reference (offline) or openai (paid live calls)
  --model <name>        Override OPENAI_MODEL in live mode
  --analysis-budget N  Counterfactual replay limit per analyzed mode (default 24)
  --output <file.json>  Write the full reproducible result; otherwise prints JSON
  --help               Show this help

Live mode reads OPENAI_API_KEY from the environment; it never accepts a browser key.
Live batches are limited to 3 seeds. No model calls are made in reference mode.
`;

export function parseArgs(argv) {
  const [command = 'compare', ...args] = argv;
  if (command === '--help' || command === '-h') return { help: true };
  if (!['run', 'compare', 'benchmark', 'scenarios'].includes(command)) throw new Error('Unknown command. Use --help for usage.');
  const names = {
    scenario: 'scenarioId', seed: 'seed', attempts: 'attempts', mode: 'mode', seeds: 'seedCount',
    policy: 'policyKind', 'policy-kind': 'policyKind', model: 'model', 'analysis-budget': 'analysisBudget', output: 'output',
  };
  const numeric = new Set(['seed', 'attempts', 'seedCount', 'analysisBudget']);
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
    options[name] = numeric.has(name) ? Number(raw) : raw;
  }
  const output = options.output;
  delete options.output;
  if (command !== 'run' && options.mode) throw new Error('--mode applies only to run.');
  if (command === 'run' && Object.hasOwn(options, 'seedCount')) throw new Error('--seeds applies only to compare or benchmark.');
  if (command === 'scenarios' && Object.keys(options).length) throw new Error('scenarios does not accept experiment options.');
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
    const result = parsed.operation === 'scenarios' ? config() : await execute(parsed.operation, parsed.options);
    const data = `${JSON.stringify(result, null, 2)}\n`;
    if (parsed.output) {
      const outputPath = path.resolve(parsed.output);
      await writeFile(outputPath, data, { flag: 'wx' });
      console.log(`Saved ${parsed.operation} result to ${outputPath}`);
    } else console.log(data.trimEnd());
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
