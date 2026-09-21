import type { HarnessKernel } from './kernel.ts';

/**
 * Claude Agent SDK adapter — structural types matching the SDK's hook
 * contract, so no SDK dependency is needed (the SDK accepts plain async
 * functions in `options.hooks`).
 *
 * Usage:
 *   const kernel = harnessKernel({ agentId: 'claude-governed', goal: '...', policy });
 *   const hooks = claudeHooks(kernel);
 *   query({ prompt, options: { hooks: { PreToolUse: [{ hooks: [hooks.preToolUse] }],
 *                                          PostToolUse: [{ hooks: [hooks.postToolUse] }] } } })
 */

/** SDK PreToolUse input (subset we read). */
export interface ClaudePreToolInput {
  readonly hook_event_name?: string;
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly session_id?: string;
}

/** SDK PostToolUse input (subset we read). */
export interface ClaudePostToolInput extends ClaudePreToolInput {
  readonly tool_response?: unknown;
}

/** SDK HookJSONOutput (the fields we set). */
export interface ClaudeHookOutput {
  readonly hookSpecificOutput?: {
    readonly hookEventName: string;
    readonly permissionDecision?: 'allow' | 'deny' | 'ask';
    readonly permissionDecisionReason?: string;
  };
  readonly systemMessage?: string;
}

export function claudeHooks(kernel: HarnessKernel): {
  preToolUse: (input: ClaudePreToolInput, toolUseId?: string) => Promise<ClaudeHookOutput>;
  postToolUse: (input: ClaudePostToolInput, toolUseId?: string) => Promise<ClaudeHookOutput>;
} {
  return {
    preToolUse: async (input, toolUseId) => {
      const v = await kernel.gateTool({
        toolName: input.tool_name, input: input.tool_input,
        ...(toolUseId !== undefined && { callId: toolUseId }),
      });
      if (v.decision === 'allow') return {}; // no output = proceed
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: v.decision, // 'deny' | 'ask'
          ...(v.reason !== undefined && { permissionDecisionReason: v.reason }),
        },
      };
    },
    postToolUse: async (input, toolUseId) => {
      const response = input.tool_response;
      const isError = response !== null && typeof response === 'object' &&
        ('error' in response || 'is_error' in response);
      kernel.observeTool(
        { toolName: input.tool_name, input: input.tool_input, ...(toolUseId !== undefined && { callId: toolUseId }) },
        isError ? { error: String((response as Record<string, unknown>)['error'] ?? 'tool error') } : { output: response },
      );
      return {};
    },
  };
}
