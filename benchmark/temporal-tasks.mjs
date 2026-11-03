// Evaluator-only task generators. Do not import this module into browser code.
// Expected answers remain in closures and are never part of an observation.
export const TEMPORAL_TASKS = [
  {
    id: 'temporal_history', family: 'temporal_state_tracking', label: 'Effective-time history', split: 'development', suite: 'temporal',
    capabilities: ['effective_vs_received_time', 'out_of_order_history', 'future_effective_records', 'insufficient_evidence'],
  },
  {
    id: 'temporal_revision', family: 'temporal_state_tracking', label: 'Historical revision', split: 'evaluation', suite: 'temporal',
    capabilities: ['effective_vs_received_time', 'late_revision', 'retraction', 'same_past_different_knowledge'],
  },
];

const clone = value => structuredClone(value);
const queryTimes = [4, 8, 11, 14];
const action = value => ({ id: value, description: `Answer: ${value}`, cost: 0 });
function random(seed, salt) {
  let x = seed >>> 0;
  for (const ch of salt) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let y = x;
    y = Math.imul(y ^ y >>> 15, y | 1);
    y ^= y + Math.imul(y ^ y >>> 7, y | 61);
    return ((y ^ y >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function historyRecords(values, variant) {
  const assign = (receivedTime, id, effectiveTime, value) => ({ receivedTime, id, type: 'assign', effectiveTime, value });
  return [
    assign(1, 'h1', 2, values[0]),
    assign(2, 'h2', variant === 'temporal_shift' ? 3 : 6, values[1]),
    assign(3, 'h3', 4, values[2]),
    assign(5, 'h4', 5, values[3]),
    assign(6, 'h5', 12, values[2]),
    assign(7, 'h6', 0, values[1]),
    assign(9, 'h7', 9, values[0]),
    assign(10, 'h8', 7, values[2]),
    assign(12, 'h9', 11, values[1]),
    assign(13, 'h10', 10, values[3]),
  ];
}

function revisionRecords(values, variant) {
  const assign = (receivedTime, id, effectiveTime, value) => ({ receivedTime, id, type: 'assign', effectiveTime, value });
  const retract = (receivedTime, id, target) => ({ receivedTime, id, type: 'retract', target });
  return [
    assign(1, 'r1', 0, values[0]),
    assign(2, 'r2', 4, values[1]),
    assign(3, 'r3', 8, values[2]),
    assign(5, 'r4', 2, values[3]),
    // This late assignment revises the answer about time 5 only in the base case.
    assign(6, 'r5', variant === 'temporal_shift' ? 6 : 5, values[2]),
    assign(7, 'r6', 9, values[0]),
    retract(9, 'x1', 'r5'),
    assign(10, 'r7', 3, values[3]),
    retract(12, 'x2', 'r2'),
    assign(13, 'r8', 12, values[0]),
  ];
}

function answerAt(records, query) {
  const known = records.filter(record => record.receivedTime <= query.knowledgeTime);
  const retracted = new Set(known.filter(record => record.type === 'retract').map(record => record.target));
  const eligible = known.filter(record => record.type === 'assign'
    && !retracted.has(record.id) && record.effectiveTime <= query.effectiveTime);
  eligible.sort((a, b) => b.effectiveTime - a.effectiveTime);
  return eligible[0]?.value ?? 'unknown';
}

export function createTemporalTask({ taskId, seed, variant = 'base', interference = 0, timeOffset = 0, stateMode = 'temporal' }) {
  const metadata = TEMPORAL_TASKS.find(task => task.id === taskId);
  if (!metadata) throw new RangeError('Unknown temporal benchmark task.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new RangeError('Invalid task seed.');
  if (!['base', 'temporal_shift'].includes(variant)) throw new RangeError('variant must be base or temporal_shift.');
  if (!Number.isInteger(interference) || interference < 0 || interference > 3) throw new RangeError('interference must be between 0 and 3.');
  if (!Number.isInteger(timeOffset) || Math.abs(timeOffset) > 1000000) throw new RangeError('timeOffset must be an integer between -1000000 and 1000000.');
  if (stateMode !== 'temporal') throw new RangeError('Focused temporal tasks require temporal state mode.');

  // Neither variant nor clock translation influences label or option order.
  const rng = random(seed, taskId);
  const values = shuffled(['Aster', 'Birch', 'Cedar', 'Dune'], rng);
  const rawRecords = taskId === 'temporal_history' ? historyRecords(values, variant) : revisionRecords(values, variant);
  const records = rawRecords.map(record => ({
    ...record,
    receivedTime: record.receivedTime + timeOffset,
    ...(record.type === 'assign' ? { effectiveTime: record.effectiveTime + timeOffset } : {}),
  }));
  const effectiveTimes = taskId === 'temporal_history' ? [1, 6, 8, 12] : [5, 5, 5, 5];
  const queries = queryTimes.map((t, i) => ({ t, effectiveTime: effectiveTimes[i] + timeOffset, knowledgeTime: t + timeOffset }));
  const expected = new Map(queries.map(query => [`query_${query.t}`, answerAt(records, query)]));
  const definitions = [];
  for (let t = 1; t <= 14; t++) {
    const query = queries.find(item => item.t === t);
    if (query) {
      definitions.push({
        t, checkpointId: `query_${t}`,
        observation: `Temporal query: ${JSON.stringify({ effectiveTime: query.effectiveTime, knowledgeTime: query.knowledgeTime })}\nUsing only records received so far, which assignment label applies at the queried effective time?`,
        actions: shuffled([...values, 'unknown'], rng).map(action),
      });
      continue;
    }
    const record = records.find(item => item.receivedTime === t + timeOffset);
    const maintenance = Array.from({ length: interference }, (_, i) => `Unrelated maintenance channel ${i + 1}: archive status normal; no assignment state changed.`);
    definitions.push({
      t, checkpointId: `arrival_${t}`,
      observation: [`Received record: ${JSON.stringify(record)}`, ...maintenance].join('\n'),
      actions: [{ id: 'continue', description: 'Record the observation and continue.', cost: 0 }],
    });
  }

  return {
    public: {
      objective: taskId === 'temporal_history'
        ? 'Answer four historical assignment queries using the records available at each query.'
        : 'Answer the same historical assignment question at four successive knowledge times.',
      rules: [
        'All records describe one assignment. Labels have no priority or numerical meaning.',
        'Use only records already received in this attempt, with receivedTime at or before the query knowledgeTime. Later records are unavailable.',
        'An assign record sets its label from its effectiveTime onward. Future-effective records do not apply before that time.',
        'Among eligible assignment records, select the greatest effectiveTime at or before the query effectiveTime. Arrival order does not determine precedence. Assignment effective times are distinct.',
        'A received retract record removes its target assignment from subsequent knowledge snapshots, including questions about the past. Other non-retracted assignments can still apply.',
        'If no eligible non-retracted assignment is known, answer unknown. Do not infer an unreceived record.',
        'A prior answer is not new evidence. New records can change a later answer about the same past effective time.',
        'Maintenance-channel observations are unrelated to the task objective and do not change its state.',
      ],
      effortBudget: null,
    },
    definitions,
    transition(definition, chosen, state) {
      state.choices[definition.checkpointId] = chosen.id;
      return definition.checkpointId.startsWith('query_')
        ? `Answer recorded: ${chosen.id}. Scoring follows the completed attempt.`
        : 'Record received.';
    },
    score(state) {
      return queries.map(query => {
        const checkpointId = `query_${query.t}`;
        const passed = state.choices[checkpointId] === expected.get(checkpointId);
        return {
          id: checkpointId, passed, detectedAt: 14, decisionT: query.t,
          candidateCheckpoints: [checkpointId],
          observation: `The answer at ${checkpointId} was ${passed ? 'correct' : 'incorrect'} under the published temporal rules.`,
        };
      });
    },
    // Evaluator-only audit hook. Never include this key in actor/analyst contexts,
    // public API task descriptions, trajectories, outcomes, or serialized reports.
    answerKey: () => [...expected].map(([checkpointId, answerId]) => ({ checkpointId, answerId })),
    instanceId: `${taskId}:${seed}:${variant}:interference${interference}:offset${timeOffset}`,
  };
}
