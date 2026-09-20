/**
 * Coding agent — the reference domain profile end-to-end.
 *
 * A MockModel drives ReAct against a real WorkspaceEnvironment through
 * coding tools: read_file → run_command → answer. Same runtime, same
 * policy gate, same event stream — only the world changed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowAllPolicy, createAgentSpec, createGoal } from '@naro/core';
import { MockModel } from '@naro/model';
import { ReActReasoner } from '@naro/reasoning';
import { AgentRunner, CompositeExecutor } from '@naro/runtime';
import { ToolExecutor, ToolRegistry } from '@naro/tools';
import { codingTools, WorkspaceEnvironment } from '@naro/profile-coding';

const dir = await mkdtemp(join(tmpdir(), 'naro-coding-'));
await writeFile(join(dir, 'answer.txt'), '42\n');

try {
  const env = new WorkspaceEnvironment({ root: dir }, 'ws');
  const tools = codingTools(env);
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);

  // A model that: reads the file, runs a check, then answers.
  const model = new MockModel({
    responses: [
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 't1', name: 'read_file', arguments: { path: 'answer.txt' } },
      ] }, finishReason: 'tool-calls' },
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 't2', name: 'run_command', arguments: { command: 'cat answer.txt' } },
      ] }, finishReason: 'tool-calls' },
      { message: { role: 'assistant', content: 'The file contains 42.' }, finishReason: 'stop' },
    ],
  });

  const runner = new AgentRunner({
    spec: createAgentSpec({ name: 'coding-agent', goal: createGoal({ description: 'read answer.txt and report its contents' }) }),
    reasoner: new ReActReasoner(model, {
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: { ...t.inputSchema } as Record<string, unknown> })),
    }),
    executor: new CompositeExecutor({ 'env://': env, 'tool://': new ToolExecutor(registry) }),
    policy: allowAllPolicy,
  });

  runner.on('*', (e) => console.log(`  [${e.seq}] ${e.type}`));
  const result = await runner.run();
  console.log(`\nstatus=${result.status} result=${JSON.stringify(result.result)}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
