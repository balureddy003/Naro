/**
 * minimal-agent — the whole Naro loop in ~100 lines.
 *
 * Goal → Understand → Plan → Reason → Act → Observe → Verify → Complete
 *
 * Nothing here is domain-specific: swap the environment for a browser,
 * the tools for APIs, the reasoner for ReAct — the runtime never changes.
 * Run it:  npm run example   (from the repo root)
 */
import { createAgentSpec, createGoal, type ActionExecutor, type Verifier } from '@naro/core';
import { AgentRunner, CompositeExecutor, DirectReasoner, FileCheckpointStore } from '@naro/runtime';
import { MockModel } from '@naro/model';
import { ToolExecutor, ToolRegistry, createToolPolicy, type Tool } from '@naro/tools';
import { InMemoryEnvironment } from '@naro/environment';

// ── 1. Goal: what are we trying to accomplish? ──────────────────────────
const goal = createGoal({
  description: 'Compute 40+2, store the answer, and read it back.',
  successCriteria: ['the stored value equals 42'],
});

// ── 2. Model: capability-gated. A MockModel keeps this fully offline. ───
// In a real agent the reasoner would call model.chat(); here the
// DirectReasoner plays that role so the loop is inspectable end-to-end.
const model = new MockModel({ capabilities: ['chat', 'tool-calling'] });
console.log(`model: ${model.id} (${model.provider}) caps=${[...model.capabilities].join(',')}`);

// ── 3. Tools: capabilities with contracts. ──────────────────────────────
const calculator: Tool = {
  name: 'calculator',
  description: 'adds two numbers',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  outputSchema: { type: 'number' },
  permissions: [],
  sideEffects: 'none',
  execute: (input) => {
    const { a, b } = input as { a: number; b: number };
    return Promise.resolve(a + b);
  },
};
const registry = new ToolRegistry().register(calculator);

// ── 4. Environment: the world the agent acts on. ────────────────────────
const environment = new InMemoryEnvironment('local');

// ── 5. Reasoner: strategy lives here; runtime just executes Decisions. ──
const reasoner = new DirectReasoner((ctx) => {
  const saw = (kind: string) => ctx.observations.filter((o) => o.kind === kind);
  if (ctx.context.length === 0) return { kind: 'need-context', query: 'arithmetic rules' };
  if (saw('tool-result').length === 0) {
    return { kind: 'act', action: { capability: 'tool.invoke', target: 'tool://calculator', input: { a: 40, b: 2 } } };
  }
  if (!ctx.observations.some((o) => o.kind === 'env-change' && (o.output as { key?: string })?.key === 'answer')) {
    const sum = saw('tool-result').at(-1)?.output;
    return { kind: 'act', action: { capability: 'env.set', target: 'env://local/answer', input: sum } };
  }
  if (!ctx.observations.some((o) => o.kind === 'env-change' && o.actionId !== undefined && o.source === 'env://local' && typeof o.output !== 'object')) {
    return { kind: 'act', action: { capability: 'env.get', target: 'env://local/answer' } };
  }
  const answer = ctx.observations.filter((o) => o.source === 'env://local' && o.success).at(-1)?.output;
  return { kind: 'complete', result: answer };
});

// ── 6. Verify: the environment's evidence decides, not the model. ───────
const verifier: Verifier = {
  id: 'answer-check',
  // Verifies only what it can judge: the read-back evidence and the
  // claimed final result. Other steps pass through — verification is
  // evidence, not a blanket veto.
  verify: ({ observation, result }) => {
    if (result !== undefined) {
      return Promise.resolve({ ok: result === 42, evidence: result,
        ...(result !== 42 && { reason: `expected 42, got ${JSON.stringify(result)}` }) });
    }
    if (observation?.source === 'env://local' && typeof observation.output === 'number') {
      return Promise.resolve({ ok: observation.output === 42, evidence: observation.output });
    }
    return Promise.resolve({ ok: true });
  },
};

// ── 7. Wire it: CompositeExecutor routes tool:// vs env:// targets. ──────
const executor: ActionExecutor = new CompositeExecutor({
  'tool://': new ToolExecutor(registry),
  'env://': environment,
});

const runner = new AgentRunner({
  spec: createAgentSpec({ name: 'minimal-agent', goal }),
  reasoner,
  executor,
  policy: createToolPolicy(registry),   // every action is policy-checked
  verifier,
  checkpoints: new FileCheckpointStore('.naro/checkpoints'),
  context: { retrieve: () => Promise.resolve([{ id: 'c1', source: 'docs', content: 'addition is commutative' }]) },
  maxIterations: 20,
});

// ── 8. Observe everything. ──────────────────────────────────────────────
runner.on('*', (e) => {
  const detail =
    e.type === 'agent.state_changed' ? `${e.data.from} → ${e.data.to}` :
    e.type === 'action.requested'    ? `${e.data.action.capability} ${e.data.action.target}` :
    e.type === 'observation.created' ? `${e.data.observation.kind} success=${e.data.observation.success}` :
    e.type === 'verification.completed' ? `ok=${e.data.ok}` :
    e.type === 'reasoning.completed' ? `decision=${e.data.decision}` : '';
  console.log(`  [${String(e.seq).padStart(2)}] ${e.type.padEnd(26)} ${detail}`);
});

const result = await runner.run();
console.log(`\nstatus=${result.status} state=${result.state} result=${JSON.stringify(result.result)}`);
console.log(`events=${result.events.length}  (checkpointed to .naro/checkpoints/)`);
