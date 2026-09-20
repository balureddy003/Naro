/**
 * react-agent — a real Model in the reasoning loop.
 *
 * Same runtime as minimal-agent; only the *strategy* changed: a
 * ReActReasoner drives an actual model interface (MockModel here —
 * swap in an OpenAI/Ollama adapter and the loop is identical).
 *
 * Run:  node examples/react-agent/src/index.ts
 */
import { createAgentSpec, createGoal, type Verifier } from '@naro/core';
import { AgentRunner, CompositeExecutor } from '@naro/runtime';
import { MockModel, textResponse } from '@naro/model';
import { ToolExecutor, ToolRegistry, createToolPolicy, type Tool } from '@naro/tools';
import { InMemoryEnvironment } from '@naro/environment';
import { ContextEngine, KeywordSource } from '@naro/context';
import { InMemoryMemoryStore } from '@naro/memory';
import { ReActReasoner, toToolSpec } from '@naro/reasoning';

const goal = createGoal({
  description: 'What is 40 + 2? Use the calculator, then answer.',
  successCriteria: ['the final answer contains 42'],
});

// A MockModel that *plays* an LLM: tool-calls until it sees the result,
// then answers in text. Swap for a provider adapter to go live.
const model = new MockModel({
  capabilities: ['chat', 'tool-calling'],
  respond: (req) => {
    const sawResult = req.messages.some((m) => m.role === 'tool');
    if (!sawResult) {
      return {
        message: { role: 'assistant', content: '', toolCalls: [
          { id: 'call-1', name: 'calculator', arguments: { a: 40, b: 2 } },
        ] },
        finishReason: 'tool-calls',
      };
    }
    return textResponse('The answer is 42.');
  },
});

const calculator: Tool = {
  name: 'calculator',
  description: 'adds two numbers',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  outputSchema: { type: 'number' },
  permissions: [],
  sideEffects: 'none',
  execute: (input) => Promise.resolve((input as { a: number; b: number }).a + (input as { a: number; b: number }).b),
};

const registry = new ToolRegistry().register(calculator);
const environment = new InMemoryEnvironment('local');
const context = new ContextEngine({
  sources: [new KeywordSource('handbook', [{ id: 'h1', text: 'calculator tool: pass {a,b} numbers to add' }])],
});
const memory = new InMemoryMemoryStore();

const reasoner = new ReActReasoner(model, { tools: [toToolSpec(calculator)] });

const verifier: Verifier = {
  id: 'answer-42',
  // Goal-level check only: judge the claimed result, let steps pass through.
  verify: ({ result }) => Promise.resolve(
    result === undefined
      ? { ok: true }
      : { ok: typeof result === 'string' && result.includes('42'), evidence: result },
  ),
};

const runner = new AgentRunner({
  spec: createAgentSpec({ name: 'react-agent', goal }),
  reasoner,
  executor: new CompositeExecutor({
    'tool://': new ToolExecutor(registry),
    'env://': environment,
  }),
  policy: createToolPolicy(registry),
  verifier,
  context,
  memory,
  maxIterations: 16,
});

runner.on('*', (e) => {
  const detail =
    e.type === 'agent.state_changed' ? `${e.data.from} → ${e.data.to}` :
    e.type === 'action.requested'    ? `${e.data.action.capability} ${e.data.action.target}` :
    e.type === 'observation.created' ? `${e.data.observation.kind} success=${e.data.observation.success}` :
    e.type === 'reasoning.completed' ? `decision=${e.data.decision}` : '';
  console.log(`  [${String(e.seq).padStart(2)}] ${e.type.padEnd(26)} ${detail}`);
});

const result = await runner.run();
console.log(`\nstatus=${result.status} result=${JSON.stringify(result.result)}`);
