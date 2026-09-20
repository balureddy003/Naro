import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { AgentDirectory, InMemoryAgentBus, delegationTool } from './index.ts';

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
