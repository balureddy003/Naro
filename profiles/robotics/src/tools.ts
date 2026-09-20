import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { RoboticsEnvironment } from './robotics-env.ts';

/** Model-facing tools over the robotics environment. */
export function roboticsTools(env: RoboticsEnvironment): Tool[] {
  const call = async (cap: string, input: unknown, ctx: ExecContext): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability: cap, target: `env://${env.id}/${cap}`, input }), ctx);
    if (!obs.success) throw new Error(obs.error ?? `${cap} failed`);
    return obs.output;
  };
  return [
    {
      name: 'robot_sense',
      description: 'Read pose {x,y,heading}, battery, and whether forward is blocked.',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['robot.sense'],
      sideEffects: 'read',
      execute: (_i, ctx) => call('robot.sense', {}, ctx),
    },
    {
      name: 'robot_act',
      description: 'Move the physical robot: {move: forward|backward|turn_left|turn_right, amount?}. Destructive — moves a real body.',
      inputSchema: {
        type: 'object',
        properties: {
          move: { type: 'string', enum: ['forward', 'backward', 'turn_left', 'turn_right'] },
          amount: { type: 'number', description: 'grid units or degrees' },
        },
        required: ['move'],
      } as const,
      permissions: ['robot.act'],
      sideEffects: 'destructive',
      execute: (i, ctx) => call('robot.act', i, ctx),
    },
    {
      name: 'robot_estop',
      description: 'Emergency stop — latches all motion off. Always callable; use robot.reset to re-arm.',
      inputSchema: { type: 'object', properties: {} },
      // No permission required: a safety stop must never be deniable.
      // (The unbypassable channel is env.emergencyStop() — this tool is
      // the agent-facing convenience, still logged and observed.)
      permissions: [],
      sideEffects: 'read', // deliberately ungateable: a safety stop is never deniable
      execute: (_i, ctx) => call('robot.estop', {}, ctx),
    },
    {
      name: 'robot_reset',
      description: 'Re-arm motion after an estop. Gate this with policy — it undoes a safety stop.',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['robot.reset'],
      sideEffects: 'write',
      execute: (_i, ctx) => call('robot.reset', {}, ctx),
    },
  ];
}
