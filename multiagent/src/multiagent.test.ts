import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { AgentDirectory, InMemoryAgentBus, delegationTool, delegationConstraints } from './index.ts';

test('directory registers agents and finds exact capabilities', () => {
  const directory = new AgentDirectory();
  directory.register({ id: 'researcher', name: 'Researcher', capabilities: ['research', 'web'] });
  directory.register({ id: 'writer', name: 'Writer', capabilities: ['writing'] });

  assert.equal(directory.get('researcher')?.name, 'Researcher');
  assert.deepEqual(directory.find('research').map((agent) => agent.id), ['researcher']);
  assert.deepEqual(directory.find('missing'), []);
});

test('in-memory bus sends a goal to the addressed agent', async () => {
  const bus = new InMemoryAgentBus();
  bus.serve('worker', async (message) => ({ from: message.from, goal: message.goal.description }));

  const result = await bus.request('worker', createGoal({ description: 'inspect logs' }), 'lead');
  assert.deepEqual(result, { from: 'lead', goal: 'inspect logs' });
});

test('in-memory bus rejects unknown agents and times out slow handlers', async () => {
  const bus = new InMemoryAgentBus();
  await assert.rejects(bus.request('missing', createGoal({ description: 'x' }), 'lead'), /no agent registered/);

  bus.serve('slow', () => new Promise((resolve) => setTimeout(resolve, 25)));
  await assert.rejects(bus.request('slow', createGoal({ description: 'x' }), 'lead', 1), /timed out/);
});

test('delegation tool requires a grant and rejects agents outside the directory', async () => {
  const bus = new InMemoryAgentBus();
  const directory = new AgentDirectory();
  const tool = delegationTool(bus, 'lead', directory);

  assert.deepEqual(tool.permissions, ['agent.delegate']);
  assert.equal(tool.sideEffects, 'write');
  await assert.rejects(
    tool.execute({ agent: 'unknown', goal: 'work' }, { agentId: 'lead', goalId: 'goal' , goal: GOAL, grants: []}),
    /unknown agent/,
  );
});

test('bounded delegation: depth cap enforced, caps/grants/context travel in goal metadata', async () => {
  const bus = new InMemoryAgentBus();
  let childGoal: import('@naro/core').Goal | undefined;
  bus.serve('researcher', (msg) => { childGoal = msg.goal; return Promise.resolve('done'); });

  const tool = delegationTool(bus, 'lead', undefined, {
    maxDepth: 1,
    allowedCapabilities: ['fs.read'],
    grants: ['tool.invoke'],
    context: 'only look at src/auth/',
  });
  const parentCtx = { agentId: 'lead', goalId: GOAL.id, goal: GOAL, grants: [], traceId: 'trace-root-1' };

  await tool.execute({ agent: 'researcher', goal: 'find the auth bug' }, parentCtx);
  assert.ok(childGoal);
  assert.equal(delegationConstraints(childGoal).depth, 1);
  assert.deepEqual(delegationConstraints(childGoal).capabilities, ['fs.read']);
  assert.deepEqual(delegationConstraints(childGoal).grants, ['tool.invoke']);
  assert.equal(delegationConstraints(childGoal).traceId, 'trace-root-1');
  assert.match(childGoal.description, /only look at src\/auth\//);
  assert.match(childGoal.constraints.join(), /fs\.read/);

  // The child at depth 1 cannot delegate further under maxDepth: 1.
  await assert.rejects(
    tool.execute({ agent: 'researcher', goal: 'go deeper' },
      { ...parentCtx, goal: childGoal }),
    /delegation depth 1 reached/,
  );
});
