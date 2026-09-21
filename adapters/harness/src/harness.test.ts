import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowAllPolicy, createGoal, verifyChain,
  type PolicyEngine, type Verifier,
} from '@naro/core';
import { harnessKernel } from './kernel.ts';
import { claudeHooks } from './claude.ts';
import { openCodePlugin } from './opencode.ts';

const kernel = (policy: PolicyEngine = allowAllPolicy, verifier?: Verifier) =>
  harnessKernel({
    agentId: 'foreign-agent', goal: createGoal({ description: 'assist' }),
    policy, ...(verifier !== undefined && { verifier }),
  });

test('allowed tool calls journal gate → execution → observation', async () => {
  const k = kernel();
  k.startSession();
  const v = await k.gateTool({ toolName: 'Read', input: { file_path: '/tmp/x' }, callId: 'c1' });
  assert.equal(v.decision, 'allow');
  k.observeTool({ toolName: 'Read', input: { file_path: '/tmp/x' }, callId: 'c1' }, { output: 'file contents' });
  await k.endSession({ result: 'done' });

  const types = k.journal().map((e) => e.type);
  for (const t of ['agent.created', 'goal.started', 'action.requested', 'permission.requested',
    'action.permitted', 'action.started', 'action.completed', 'observation.created', 'agent.completed']) {
    assert.ok(types.includes(t as never), `missing ${t}`);
  }
  assert.equal(verifyChain(k.journal()).ok, true);
});

test('a denied tool call is refused and still journaled', async () => {
  const deny: PolicyEngine = { evaluate: () => 'deny' };
  const k = kernel(deny);
  k.startSession();
  const v = await k.gateTool({ toolName: 'Bash', input: { command: 'rm -rf /' } });
  assert.equal(v.decision, 'deny');
  // Journal carries the denial as evidence even though nothing ran.
  const denied = k.journal().find((e) => e.type === 'action.denied');
  assert.ok(denied);
  assert.equal(verifyChain(k.journal()).ok, true);
});

test('require_approval maps to ask', async () => {
  const k = kernel({ evaluate: () => 'require_approval' });
  const v = await k.gateTool({ toolName: 'Write', input: {} });
  assert.equal(v.decision, 'ask');
  assert.ok(k.journal().some((e) => e.type === 'human.approval.requested'));
});

test('endSession runs the verifier — a false completion claim fails', async () => {
  const nope: Verifier = { id: 'skeptic', verify: () => ({ ok: false, reason: 'no evidence' }) };
  const k = kernel(allowAllPolicy, nope);
  k.startSession();
  const res = await k.endSession({ result: 'trust me' });
  assert.equal(res.ok, false);
  const failed = k.journal().find((e) => e.type === 'agent.failed');
  assert.ok(failed);
  const vc = k.journal().find((e) => e.type === 'verification.completed');
  assert.equal((vc as import('@naro/core').NaroEvent<'verification.completed'>).data.verifier, 'skeptic');
});

test('claudeHooks: deny maps to permissionDecision, allow returns {}', async () => {
  const denyEnv: PolicyEngine = {
    evaluate: (a) => String((a.input as { file_path?: string }).file_path ?? '').endsWith('.env') ? 'deny' : 'allow',
  };
  const hooks = claudeHooks(kernel(denyEnv));

  const blocked = await hooks.preToolUse({ tool_name: 'Read', tool_input: { file_path: '/app/.env' } }, 'tu_1');
  assert.equal(blocked.hookSpecificOutput?.permissionDecision, 'deny');

  const ok = await hooks.preToolUse({ tool_name: 'Read', tool_input: { file_path: '/app/index.ts' } }, 'tu_2');
  assert.deepEqual(ok, {});

  await hooks.postToolUse({ tool_name: 'Read', tool_input: { file_path: '/app/index.ts' }, tool_response: 'x' }, 'tu_2');
  assert.ok(true);
});

test('openCodePlugin: before throws on deny, after records the result', async () => {
  const k = kernel({ evaluate: (a) => a.target === 'tool://bash' ? 'deny' : 'allow' });
  const plugin = await openCodePlugin(k)();

  await assert.rejects(
    plugin['tool.execute.before']({ tool: 'bash', callID: 'c1' }, { args: { command: 'rm -rf /' } }),
    /denied 'bash'/,
  );
  await plugin['tool.execute.before']({ tool: 'read', callID: 'c2' }, { args: { filePath: 'x' } });
  await plugin['tool.execute.after']({ tool: 'read', callID: 'c2' }, { output: 'contents' });

  assert.equal(verifyChain(k.journal()).ok, true);
  assert.ok(k.journal().some((e) => e.type === 'action.completed'));
});

test('results pair with their gated action by callId', async () => {
  const k = kernel();
  k.startSession();
  await k.gateTool({ toolName: 'A', input: 1, callId: 'a' });
  await k.gateTool({ toolName: 'B', input: 2, callId: 'b' });
  k.observeTool({ toolName: 'B', input: 2, callId: 'b' }, { output: 'b-result' });
  k.observeTool({ toolName: 'A', input: 1, callId: 'a' }, { output: 'a-result' });

  const completed = k.journal().filter((e) => e.type === 'action.completed');
  const obsB = (completed[0]!.data as { observation: { output: unknown } }).observation;
  const obsA = (completed[1]!.data as { observation: { output: unknown } }).observation;
  assert.equal(obsB.output, 'b-result');
  assert.equal(obsA.output, 'a-result');
  // Actions paired correctly even though results arrived out of order.
  assert.equal((completed[0]!.data as { action: { target: string } }).action.target, 'tool://B');
});
