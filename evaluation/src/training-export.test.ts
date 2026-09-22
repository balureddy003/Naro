import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowAllPolicy, createAgentSpec, createGoal, createObservation, type ActionExecutor } from '@naro/core';
import { AgentRunner, DirectReasoner } from '@naro/runtime';
import { exportTrainingExamples, toJsonl } from './training-export.ts';

const echo: ActionExecutor = {
  execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true, output: a.input })),
};

const passVerifier = { id: 'always-ok', verify: async () => ({ ok: true }) };
const failVerifier = { id: 'always-fails', verify: async () => ({ ok: false, reason: 'nope' }) };

async function run(verifier?: { id: string; verify: () => Promise<{ ok: boolean; reason?: string }> }) {
  const runner = new AgentRunner({
    spec: createAgentSpec({ name: 'x', goal: createGoal({ description: 'set k to done' }) }),
    reasoner: new DirectReasoner((ctx) =>
      ctx.observations.length === 0
        ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 'done' } } as never
        : { kind: 'complete', result: 'done' }),
    executor: echo,
    policy: allowAllPolicy,
    ...(verifier !== undefined && { verifier }),
  });
  return runner.run();
}

test('a verified run exports one transcript matching buildMessages shape', async () => {
  const result = await run(passVerifier);
  const [example] = exportTrainingExamples(result.events);
  assert.ok(example);
  assert.equal(example!.verified, true);
  assert.equal(example!.outcome, 'completed');
  assert.equal(example!.messages[0]!.role, 'system');
  assert.ok(example!.messages.some((m) => m.role === 'user' && String(m.content).includes('GOAL:')));
  // env.set isn't a tool-call action (no toolCallId), so its observation
  // renders as a plain evidence message — proves the real Action/Observation
  // trail round-tripped through the event stream into buildMessages.
  assert.ok(example!.messages.some((m) => String(m.content).includes('done')));
});

test('an unverified run is excluded by default', async () => {
  const result = await run(); // no verifier configured at all
  assert.deepEqual(exportTrainingExamples(result.events), []);
});

test('verifiedOnly: false includes runs that failed verification', async () => {
  const result = await run(failVerifier);
  assert.deepEqual(exportTrainingExamples(result.events), []);
  const [example] = exportTrainingExamples(result.events, { verifiedOnly: false });
  assert.equal(example!.verified, false);
});

test('multiple runs in one event list are exported separately', async () => {
  const a = await run(passVerifier);
  const b = await run(passVerifier);
  const examples = exportTrainingExamples([...a.events, ...b.events]);
  assert.equal(examples.length, 2);
  assert.notEqual(examples[0]!.runId, examples[1]!.runId);
});

test('toJsonl round-trips one example per line', async () => {
  const result = await run(passVerifier);
  const examples = exportTrainingExamples(result.events);
  const lines = toJsonl(examples).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal((JSON.parse(lines[0]!) as { runId: string }).runId, examples[0]!.runId);
});
