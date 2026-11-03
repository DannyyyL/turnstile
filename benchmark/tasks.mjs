/** Task generators keep answer keys in closures, never in policy-visible data. */
import { TEMPORAL_TASKS, createTemporalTask } from './temporal-tasks.mjs';
import { DYNAMICS_TASKS, createDynamicsTask } from './dynamics-tasks.mjs';
export { TEMPORAL_TASKS, DYNAMICS_TASKS };
export const ACTIVE_TASKS = [...DYNAMICS_TASKS, ...TEMPORAL_TASKS];
export const LEGACY_TASKS = [
  { id: 'temporal_release', family: 'delayed_consequences', label: 'Budgeted service release', split: 'development' },
  { id: 'temporal_dispatch', family: 'delayed_consequences', label: 'Budgeted shipment dispatch', split: 'development' },
  { id: 'state_ledger', family: 'temporal_state_tracking', label: 'Versioned custody ledger', split: 'development' },
  { id: 'state_access', family: 'temporal_state_tracking', label: 'Expiring access assignments', split: 'development' },
  { id: 'temporal_pipeline', family: 'delayed_consequences', label: 'Coupled transfer pipeline', split: 'evaluation' },
  { id: 'state_reservations', family: 'temporal_state_tracking', label: 'Reservation capacity ledger', split: 'evaluation' },
];
export const TASKS = [...ACTIVE_TASKS, ...LEGACY_TASKS.map(task => ({ ...task, suite: 'legacy' }))];
const clone = value => structuredClone(value);
const action = (id, description, cost = 0) => ({ id, description, cost });
const step = (t, id, observation, actions = [action('continue', 'Record the observation and continue.')]) => ({ t, checkpointId: id, observation, actions });
function random(seed, salt) {
  let x = seed >>> 0;
  for (const ch of salt) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => { x += 0x6d2b79f5; let y = x; y = Math.imul(y ^ y >>> 15, y | 1); y ^= y + Math.imul(y ^ y >>> 7, y | 61); return ((y ^ y >>> 14) >>> 0) / 4294967296; };
}
function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function delayedTask(id, seed, delay) {
  const rng = random(seed, id);
  const risks = id === 'temporal_release' ? [
    ['persistence', 'A restart can remove work acknowledged only in memory.', 'Persist work before acknowledging it.', 'Keep work in memory.', 'Restart probe lost acknowledged work.'],
    ['compatibility', 'An old client can reject a new-only payload.', 'Maintain both payload versions.', 'Emit only the new payload.', 'Compatibility probe could not decode the payload.'],
    ['capacity', 'A burst can exceed a fixed-rate receiver quota.', 'Schedule retries with backoff.', 'Retry at a fixed interval.', 'Burst probe exceeded the retry quota.'],
  ] : [
    ['temperature', 'A warm route can spoil an uncooled shipment.', 'Use a refrigerated container.', 'Use a plain container.', 'Route probe found spoiled cargo.'],
    ['customs', 'An international route can require a customs manifest.', 'Prepare the customs manifest.', 'Use domestic paperwork.', 'Border probe rejected the paperwork.'],
    ['fragility', 'A rough route can damage unpacked fragile cargo.', 'Add protective packing.', 'Use standard packing.', 'Handling probe found damaged cargo.'],
  ];
  const inactive = Math.floor(rng() * risks.length);
  const active = risks.filter((_, i) => i !== inactive).map(r => r[0]);
  const probeT = 5 + delay;
  const definitions = [step(1, 'inspection', 'Choose whether to inspect the workload before committing the three plans.', [action('skip', 'Proceed without inspection.'), action('inspect', 'Inspect which two of the three edge conditions will occur.', 1)])];
  for (let i = 0; i < risks.length; i++) {
    const [key, rule, guard, fast] = risks[i];
    definitions.push(step(i + 2, key, `${rule} Commit this part of the plan now; it cannot change during this attempt.`, shuffled([
      action('basic', fast, 1), action('guarded', guard, 3),
    ], rng)));
  }
  for (let t = 5; t <= 14; t++) definitions.push(step(t, t === probeT ? 'integration_probe' : `transit_${t}`,
    t === probeT ? 'Run the measured integration probes against the frozen plan.' : 'Routine progress check: ordinary traffic or cargo is healthy. This does not test the edge conditions.'));
  return {
    public: { objective: 'Pass every integration gate within eight effort units.', rules: ['Exactly two edge conditions occur. Inspection reveals which ones.', 'Guarding an inactive condition is unnecessary. All three guards exceed the budget.', 'Only inspection and the three plan choices consume effort.'], effortBudget: 8 },
    definitions,
    transition(definition, chosen, state) {
      state.spent += chosen.cost;
      state.choices[definition.checkpointId] = chosen.id;
      if (definition.checkpointId === 'inspection' && chosen.id === 'inspect') return `Inspection observed edge conditions: ${active.join(', ')}. The remaining condition does not occur.`;
      if (definition.t === probeT) return risks.map(([key, , , , failure]) => active.includes(key) && state.choices[key] !== 'guarded' ? failure : `PASS: ${key} gate.`).join(' ');
      return `Recorded ${chosen.id} at ${definition.checkpointId}.`;
    },
    score(state) {
      const checks = risks.map(([key, , , , failure], i) => {
        const passed = !active.includes(key) || state.choices[key] === 'guarded';
        return { id: key, passed, detectedAt: probeT, candidateCheckpoints: risks.map(r => r[0]), observation: passed ? `PASS: ${key} gate.` : failure, decisionT: i + 2 };
      });
      // A cumulative effort violation has no unique causal decision delay.
      checks.push({ id: 'effort_budget', passed: state.spent <= 8, detectedAt: 14, candidateCheckpoints: ['inspection', ...risks.map(r => r[0])], observation: `Effort used: ${state.spent}/8.`, decisionT: null });
      return checks;
    },
  };
}

function pipelineTask(seed, delay) {
  const rng = random(seed, 'temporal_pipeline');
  // Profiles require different affordable plans. No globally safe plan fits.
  const profiles = [
    { burst: true, legacy: false, interruption: true },
    { burst: false, legacy: true, interruption: false },
    { burst: true, legacy: true, interruption: false },
  ];
  const workload = profiles[Math.floor(rng() * profiles.length)];
  const probeT = 5 + delay;
  const definitions = [
    step(1, 'inspection', 'Choose whether to inspect the source link, receiving system, and handoff conditions before selecting the pipeline.', [action('skip', 'Proceed without inspecting the transfer.', 0), action('inspect', 'Inspect the measured transfer conditions.', 1)]),
    step(2, 'encoding', 'Choose the representation that crosses the source link. Raw records cost less effort; compact records fit a burst-limited link.', shuffled([action('raw', 'Transfer raw records.', 1), action('compact', 'Compress records before crossing the source link.', 2)], rng)),
    step(3, 'bridge', 'Choose the recipient bridge, which runs after the link transfer. Legacy recipients accept raw records only. Transcoding can decode compact records after they cross the link.', shuffled([action('passthrough', 'Send the selected representation directly to the recipient.', 1), action('transcode', 'Decode compact records to raw records at the recipient.', 3)], rng)),
    step(4, 'buffer', 'Choose handoff storage. An interruption removes an in-memory buffer; durable storage survives it.', shuffled([action('transient', 'Keep the handoff buffer in memory.', 1), action('durable', 'Persist the handoff buffer.', 3)], rng)),
  ];
  for (let t = 5; t <= 14; t++) definitions.push(step(t, t === probeT ? 'integration_probe' : `transit_${t}`,
    t === probeT ? 'Exercise the measured source link, recipient bridge, and handoff interruption conditions.' : 'Ordinary transfer progress is healthy. This does not test edge conditions.'));
  const checksFor = state => {
    const gates = [
      { id: 'link_capacity', passed: !workload.burst || state.choices.encoding === 'compact', observation: 'The source link could not carry the raw-record burst.', decisionT: 2 },
      { id: 'recipient_compatibility', passed: !workload.legacy || state.choices.encoding === 'raw' || state.choices.bridge === 'transcode', observation: 'The legacy recipient could not decode compact records.', decisionT: 2 },
      { id: 'handoff_recovery', passed: !workload.interruption || state.choices.buffer === 'durable', observation: 'Interrupted handoff lost the buffered records.', decisionT: 4 },
    ];
    return gates.map(gate => ({ ...gate, detectedAt: probeT, candidateCheckpoints: ['encoding', 'bridge', 'buffer'], observation: gate.passed ? `PASS: ${gate.id} gate.` : gate.observation }));
  };
  return {
    public: { objective: 'Complete a compatible transfer that survives the measured conditions within seven effort units.', rules: ['Compression changes the representation that crosses the source link.', 'The bridge runs after the link transfer; transcoding can repair recipient compatibility but cannot increase source-link capacity.', 'Memory handoff storage fails only when a handoff interruption occurs.', 'Only inspection and the three pipeline choices consume effort. Every required gate and the seven-unit effort limit must pass.'], effortBudget: 7 },
    definitions,
    transition(definition, chosen, state) {
      state.spent += chosen.cost;
      state.choices[definition.checkpointId] = chosen.id;
      if (definition.checkpointId === 'inspection' && chosen.id === 'inspect') return `Inspection observed source burst: ${workload.burst ? 'yes' : 'no'}; legacy recipient: ${workload.legacy ? 'yes' : 'no'}; handoff interruption: ${workload.interruption ? 'yes' : 'no'}.`;
      if (definition.t === probeT) return checksFor(state).map(gate => gate.observation).join(' ');
      return `Recorded ${chosen.id} at ${definition.checkpointId}.`;
    },
    score(state) {
      return [...checksFor(state), { id: 'effort_budget', passed: state.spent <= 7, detectedAt: 14, candidateCheckpoints: ['inspection', 'encoding', 'bridge', 'buffer'], observation: `Effort used: ${state.spent}/7.`, decisionT: null }];
    },
  };
}

function stateTask(id, seed, stateMode) {
  const rng = random(seed, id);
  const values = shuffled(id === 'state_ledger' ? ['Aster', 'Birch', 'Cedar', 'Dune'] : ['reader', 'writer', 'admin', 'auditor'], rng);
  // Arrival time differs from effective time. A retraction removes an event,
  // while expiration of the newest assignment does not revive an older one.
  let events = [
    { arrival: 1, id: 'e1', type: 'assign', effective: 0, value: values[0], until: null },
    { arrival: 2, id: 'e2', type: 'assign', effective: 3, value: values[1], until: 8 },
    { arrival: 3, id: 'e3', type: 'assign', effective: 1, value: values[2], until: null },
    { arrival: 4, id: 'e4', type: 'assign', effective: 2, value: values[3], until: 5 },
    { arrival: 5, id: 'r1', type: 'retract', target: 'e2' },
    { arrival: 7, id: 'e5', type: 'assign', effective: 6, value: values[1], until: 7 },
    { arrival: 8, id: 'e6', type: 'assign', effective: 4, value: values[2], until: null },
    { arrival: 9, id: 'r2', type: 'retract', target: 'e4' },
    { arrival: 11, id: 'r3', type: 'retract', target: 'e5' },
    { arrival: 12, id: 'e7', type: 'assign', effective: 9, value: values[3], until: 11 },
    { arrival: 13, id: 'e8', type: 'assign', effective: 8, value: values[0], until: null },
  ];
  if (stateMode === 'updates') events = events.map(event => event.type === 'retract'
    ? { arrival: event.arrival, id: event.id, type: 'note', target: event.target, note: 'Audit only: this note does not retract any assignment.' }
    : { ...event, until: null });
  const queries = [{ t: 6, asOf: 3 }, { t: 10, asOf: 7 }, { t: 14, asOf: 10 + Math.floor(rng() * 3) }];
  const answers = new Map();
  const definitions = [];
  for (let t = 1; t <= 14; t++) {
    const event = events.find(e => e.arrival === t);
    const query = queries.find(q => q.t === t);
    if (event) definitions.push(step(t, `arrival_${t}`, `Received ledger event: ${JSON.stringify(event)}`));
    else {
      const received = events.filter(e => e.arrival < t);
      const cancelled = new Set(received.filter(e => e.type === 'retract').map(e => e.target));
      const latest = received.filter(e => e.type === 'assign' && !cancelled.has(e.id) && e.effective <= query.asOf).sort((a, b) => b.effective - a.effective)[0];
      answers.set(t, latest && (latest.until === null || query.asOf < latest.until) ? latest.value : 'none');
      definitions.push(step(t, `query_${t}`, `Using only events received so far, what is the assignment at effective time ${query.asOf}?`, shuffled([...values, 'none'], rng).map(value => action(value, `Answer: ${value}`))));
    }
  }
  return {
    public: { objective: 'Answer all three temporal ledger queries correctly.', rules: ['Use only events received by the query checkpoint.', ...(stateMode === 'temporal'
      ? ['A retraction removes its target from all subsequent queries, including queries about the past.', 'An until time is exclusive. If the selected assignment has expired, answer none; do not revive older assignments.']
      : ['Audit notes do not modify assignments. Assignments do not expire.']), 'Choose the non-retracted assignment with the greatest effective time at or before the queried time, regardless of arrival order.', 'Future-effective assignments do not apply before their effective time.'], effortBudget: null },
    definitions,
    transition(definition, chosen, state) { state.choices[definition.checkpointId] = chosen.id; return definition.checkpointId.startsWith('query_') ? `Answer recorded: ${chosen.id}. Scoring follows the completed attempt.` : 'Event recorded.'; },
    score(state) { return queries.map(q => {
      const passed = state.choices[`query_${q.t}`] === answers.get(q.t);
      return { id: `query_${q.t}`, passed, detectedAt: 14, decisionT: q.t, candidateCheckpoints: [`query_${q.t}`], observation: `The answer at query_${q.t} was ${passed ? 'correct' : 'incorrect'} under the published ledger rules.` };
    }); },
  };
}

function reservationsTask(seed, stateMode) {
  const rng = random(seed, 'state_reservations');
  const capacity = 6 + Math.floor(rng() * 2);
  // This ledger adds concurrent reservations, unlike the assignment templates'
  // latest-value rule. Effective releases and expirations both end intervals.
  let events = [
    { arrival: 1, id: 'r1', type: 'reserve', units: 2, effective: 0, until: null },
    { arrival: 2, id: 'r2', type: 'reserve', units: 1, effective: 2, until: 5 },
    { arrival: 3, id: 'r3', type: 'reserve', units: 2, effective: 4, until: null },
    { arrival: 4, id: 'x1', type: 'release', target: 'r1', effective: 1 },
    { arrival: 5, id: 'r4', type: 'reserve', units: 1, effective: 1, until: 4 },
    { arrival: 7, id: 'r5', type: 'reserve', units: 2, effective: 6, until: 8 },
    { arrival: 8, id: 'x2', type: 'release', target: 'r3', effective: 7 },
    { arrival: 9, id: 'r6', type: 'reserve', units: 1, effective: 5, until: null },
    { arrival: 11, id: 'x3', type: 'release', target: 'r6', effective: 6 },
    { arrival: 12, id: 'r7', type: 'reserve', units: 2, effective: 9, until: 10 },
    { arrival: 13, id: 'r8', type: 'reserve', units: 1, effective: 8, until: null },
  ];
  if (stateMode === 'updates') events = events.map(event => event.type === 'release'
    ? { arrival: event.arrival, id: event.id, type: 'note', target: event.target, effective: event.effective, note: 'Audit only: this note does not release any reservation.' }
    : { ...event, until: null });
  const queries = [{ t: 6, asOf: 3 }, { t: 10, asOf: 7 }, { t: 14, asOf: 9 + Math.floor(rng() * 2) }];
  const answers = new Map();
  const definitions = [];
  for (let t = 1; t <= 14; t++) {
    const event = events.find(e => e.arrival === t);
    if (event) { definitions.push(step(t, `arrival_${t}`, `Received reservation event: ${JSON.stringify(event)}`)); continue; }
    const query = queries.find(q => q.t === t);
    const received = events.filter(e => e.arrival < t);
    const occupied = received.filter(e => e.type === 'reserve' && e.effective <= query.asOf && (e.until === null || query.asOf < e.until)
      && !received.some(release => release.type === 'release' && release.target === e.id && release.effective <= query.asOf)).reduce((sum, e) => sum + e.units, 0);
    answers.set(t, String(capacity - occupied));
    const choices = shuffled(Array.from({ length: 14 }, (_, i) => String(i - 6)), rng).map(value => action(value, `Answer: ${value} free units`));
    definitions.push(step(t, `query_${t}`, `Using only events received so far, how many of the ${capacity} capacity units are free at effective time ${query.asOf}? Negative free capacity represents overbooking.`, choices));
  }
  return {
    public: { objective: 'Answer all three remaining-capacity queries correctly.', rules: [`The pool has ${capacity} capacity units. Each active reservation consumes its stated units; sum all active reservations.`, 'Use only events received by the query checkpoint. A reservation starts at its effective time.', ...(stateMode === 'temporal'
      ? ['An until time is exclusive: a reservation is inactive at and after that time.', 'A received release ends its targeted reservation at the release effective time, including for subsequent queries about the past.']
      : ['Audit notes do not release reservations. Reservations do not expire.']), 'Free capacity equals pool capacity minus the sum of active reservation units. Negative free capacity means overbooking.'], effortBudget: null },
    definitions,
    transition(definition, chosen, state) { state.choices[definition.checkpointId] = chosen.id; return definition.checkpointId.startsWith('query_') ? `Answer recorded: ${chosen.id} free units. Scoring follows the completed attempt.` : 'Event recorded.'; },
    score(state) { return queries.map(q => {
      const passed = state.choices[`query_${q.t}`] === answers.get(q.t);
      return { id: `query_${q.t}`, passed, detectedAt: 14, decisionT: q.t, candidateCheckpoints: [`query_${q.t}`], observation: `The answer at query_${q.t} was ${passed ? 'correct' : 'incorrect'} under the published reservation rules.` };
    }); },
  };
}

export function createTask({ taskId, seed, delay = 7, stateMode = 'temporal', interference = 0, variant = 'base', timeOffset = 0, ruleAccess = 'infer' }) {
  if (DYNAMICS_TASKS.some(task => task.id === taskId)) return createDynamicsTask({ taskId, seed, ruleAccess, interference, variant, timeOffset });
  if (TEMPORAL_TASKS.some(task => task.id === taskId)) return createTemporalTask({ taskId, seed, stateMode, interference, variant, timeOffset });
  const metadata = TASKS.find(t => t.id === taskId);
  if (!metadata) throw new RangeError('Unknown benchmark task.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new RangeError('Invalid task seed.');
  if (!Number.isInteger(delay) || delay < 0 || delay > 7) throw new RangeError('delay must be between 0 and 7.');
  if (!['temporal', 'updates'].includes(stateMode)) throw new RangeError('stateMode must be temporal or updates.');
  if (!Number.isInteger(interference) || interference < 0 || interference > 3) throw new RangeError('interference must be between 0 and 3.');
  const task = taskId === 'temporal_pipeline' ? pipelineTask(seed, delay)
    : taskId === 'state_reservations' ? reservationsTask(seed, stateMode)
      : metadata.family === 'delayed_consequences' ? delayedTask(taskId, seed, delay) : stateTask(taskId, seed, stateMode);
  // The instruction is held constant; interference changes observations only.
  task.public.rules.push('Maintenance-channel observations are unrelated to the task objective and do not change its state.');
  if (interference) {
    task.definitions = task.definitions.map(definition => definition.actions.length === 1 ? {
      ...definition,
      observation: definition.observation + '\n' + Array.from({ length: interference }, (_, i) => `Unrelated maintenance channel ${i + 1}: sample batch ${definition.t * 7 + i} archived; no task state changed.`).join('\n'),
    } : definition);
  }
  // No metadata, seed, future definitions, or answer key belongs in a prompt.
  return { ...task, instanceId: `${taskId}:${seed}:${metadata.family === 'delayed_consequences' ? delay : stateMode}:interference${interference}`, public: clone(task.public) };
}
