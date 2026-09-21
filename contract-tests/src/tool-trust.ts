import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, type Action, type ExecContext, type Observation, type TrustLevel } from '@naro/core';
import type { ToolLike } from './tool-source.ts';

export interface EnvironmentLike {
  readonly id: string;
  execute(action: Action, ctx: ExecContext): Promise<Observation> | Observation;
}

/** ToolLike plus the trust stamp ToolExecutor applies to its observations. */
export interface TrustedToolLike extends ToolLike {
  readonly trust?: TrustLevel;
}

export interface ToolTrustSample {
  readonly tool: string;
  readonly capability: string;
  readonly input: unknown;
}

// system > tool > external — lower rank means less trusted.
const RANK: Record<TrustLevel, number> = { system: 2, tool: 1, external: 0 };

/**
 * For each sample, execute the env capability directly and the wrapping
 * tool; assert the tool observation's trust is no HIGHER than the
 * environment's — `external` must stay `external` (a tool that upgrades
 * outside content to 'tool' weakens banners and provenance gates).
 *
 * The tool-side trust is `tool.trust ?? 'tool'` — exactly what
 * ToolExecutor stamps on the rebuilt observation (tools/src/executor.ts);
 * the environment's own tag does not propagate through a wrapper.
 */
export function toolTrustContract(
  name: string,
  setup: () => { env: EnvironmentLike; tools: readonly TrustedToolLike[]; agentId?: string },
  samples: readonly ToolTrustSample[],
): void {
  for (const sample of samples) {
    test(`${name}: tool '${sample.tool}' preserves env trust for '${sample.capability}'`, async () => {
      const { env, tools, agentId = 'a1' } = setup();
      const tool = tools.find((t) => t.name === sample.tool);
      assert.ok(tool, `no tool named '${sample.tool}'`);
      const ctx: ExecContext = {
        agentId, goalId: 'g1', goal: createGoal({ description: 'contract' }), grants: [],
      };
      const envObs = await env.execute(
        createAction(agentId, {
          capability: sample.capability,
          target: `env://${env.id}/${sample.capability}`,
          input: sample.input,
        }),
        ctx,
      );
      await tool.execute(sample.input, ctx); // exercises the real wrapper path
      const toolTrust = tool.trust ?? 'tool';
      assert.ok(
        RANK[toolTrust] <= RANK[envObs.trust],
        `tool '${sample.tool}' stamps '${toolTrust}' but env returned '${envObs.trust}' — ` +
        `declare trust: '${envObs.trust}' on the tool (the env tag does not flow through)`,
      );
    });
  }
}
