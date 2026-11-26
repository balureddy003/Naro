import type { HarnessKernel } from './kernel.ts';

/**
 * Devin CLI adapter — structural types matching Devin's `hooks.v1.json`
 * command-hook stdin/stdout contract
 * (https://docs.devin.ai/cli/extensibility/hooks/overview), so no SDK
 * dependency is needed. A command hook reads one JSON object from stdin and
 * (optionally) writes one back to stdout; this function is the part that
 * decides what that object is — wiring stdin/stdout and the hook's exit code
 * is the calling script's job (see usage below).
 *
 * Usage (a command-hook script registered in `.devin/hooks.v1.json`):
 *   const kernel = harnessKernel({ agentId: 'devin-governed', goal: '...', policy });
 *   const hooks = devinHooks(kernel);
 *   const input = JSON.parse(await readStdin());
 *   const output = input.hook_event_name === 'PostToolUse'
 *     ? await hooks.postToolUse(input)
 *     : await hooks.preToolUse(input);
 *   process.stdout.write(JSON.stringify(output));
 *   process.exitCode = output.decision === 'block' ? 2 : 0; // belt and
 *   // braces: Devin's docs say either the exit code or the JSON blocks a
 *   // call, but don't say what happens if they disagree — set both.
 *
 * Devin's documented PreToolUse contract has no 'ask'/interactive-approval
 * decision value (unlike Claude Agent SDK's `permissionDecision: 'ask'`) and
 * no per-call correlation id — only a stable per-session id and a per-prompt
 * id shared by every hook fired in one turn, neither of which identifies one
 * tool call among several in the same turn. `gateTool`/`observeTool`'s FIFO
 * fallback (pending actions resolved in issue order when no `callId` is
 * given) is therefore load-bearing here, not a fallback path: a Devin hook
 * never has a call id to pass.
 */

export interface DevinPreToolInput {
  readonly hook_event_name?: string;
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly session_id?: string;
  readonly prompt_id?: string;
}

export interface DevinPostToolInput extends DevinPreToolInput {
  readonly tool_response?: { readonly success?: boolean; readonly output?: unknown; readonly error?: string | null };
}

/** Devin's documented command-hook stdout shape (the fields we set). */
export interface DevinHookOutput {
  readonly decision?: 'approve' | 'block';
  readonly reason?: string;
}

export function devinHooks(kernel: HarnessKernel): {
  preToolUse: (input: DevinPreToolInput) => Promise<DevinHookOutput>;
  postToolUse: (input: DevinPostToolInput) => Promise<DevinHookOutput>;
} {
  return {
    preToolUse: async (input) => {
      const v = await kernel.gateTool({ toolName: input.tool_name, input: input.tool_input });
      if (v.decision === 'allow') return {}; // exit 0, no output = proceed
      // No 'ask' primitive exists in Devin's documented PreToolUse contract
      // to hand off to a human mid-call — require_approval surfaces as a
      // block with the reason, the same tradeoff openCodePlugin makes for
      // OpenCode's lack of an ask path.
      return { decision: 'block', reason: v.reason ?? (v.decision === 'ask' ? 'requires human approval' : 'denied by policy') };
    },
    postToolUse: async (input) => {
      const response = input.tool_response;
      const isError = response?.success === false;
      kernel.observeTool(
        { toolName: input.tool_name, input: input.tool_input },
        isError ? { error: response?.error ?? 'tool error' } : { output: response?.output },
      );
      return {}; // PostToolUse is not documented as able to block or change anything
    },
  };
}
