import type { HarnessKernel } from './kernel.ts';

/**
 * OpenCode plugin adapter — structural types matching OpenCode's plugin
 * hooks, so no dependency is needed (a plugin is just an async factory
 * returning a hooks object).
 *
 * Usage (in an OpenCode plugin file):
 *   import { harnessKernel, openCodePlugin } from '@naro/adapter-harness';
 *   const kernel = harnessKernel({ agentId: 'opencode-governed', goal: '...', policy });
 *   export const Governed = openCodePlugin(kernel);
 *
 * OpenCode blocks a tool call by *throwing* inside tool.execute.before —
 * there is no 'ask' path, so 'require_approval' verdicts surface as a deny
 * with the reason carried in the error message.
 */

interface OpenCodeToolInput { readonly tool: string; readonly sessionID?: string; readonly callID?: string; }
interface OpenCodeBeforeOutput { readonly args: unknown }
interface OpenCodeAfterOutput { readonly title?: string; readonly output: unknown; readonly metadata?: Record<string, unknown> }

export function openCodePlugin(kernel: HarnessKernel): () => Promise<{
  'tool.execute.before': (input: OpenCodeToolInput, output: OpenCodeBeforeOutput) => Promise<void>;
  'tool.execute.after': (input: OpenCodeToolInput, output: OpenCodeAfterOutput) => Promise<void>;
}> {
  return async () => ({
    'tool.execute.before': async (input, output) => {
      const v = await kernel.gateTool({
        toolName: input.tool, input: output.args,
        ...(input.callID !== undefined && { callId: input.callID }),
      });
      if (v.decision !== 'allow') {
        throw new Error(`Naro policy ${v.decision === 'ask' ? 'requires approval for' : 'denied'} '${input.tool}'${v.reason ? `: ${v.reason}` : ''}`);
      }
    },
    'tool.execute.after': async (input, output) => {
      kernel.observeTool(
        { toolName: input.tool, input: {}, ...(input.callID !== undefined && { callId: input.callID }) },
        { output: output.output },
      );
    },
  });
}
