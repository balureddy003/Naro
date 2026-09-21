import type { ChatMessage, ChatRequest, FinishReason, ToolCall } from '@naro/model';

/**
 * Naro canonical ⇄ Anthropic Messages API.
 *
 * The real differences that justify a separate adapter:
 *  - system messages are a top-level `system` param, not a message
 *  - assistant tool calls are `tool_use` content blocks
 *  - tool results are `tool_result` blocks inside a *user* message
 *  - `max_tokens` is required
 *  - stop_reason vocabulary differs
 */

type CacheControl = { type: 'ephemeral' };

type Block = { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: unknown; cache_control?: CacheControl }
  | { type: 'tool_result'; tool_use_id: string; content: string; cache_control?: CacheControl }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string } };

interface AnthropicMessage { role: 'user' | 'assistant'; content: string | Block[] }

/**
 * Anthropic prompt caching: `cache_control` rides on a block, and the
 * `system` param becomes a block array when a breakpoint is set. Naro's
 * `cacheBreakpoint` marks the END of the stable prefix — the standard
 * layout is: cached system instructions + cached tool list + (optionally)
 * cached retrieved context, then volatile transcript.
 */
export function splitSystem(messages: readonly ChatMessage[]): {
  system: string | Block[] | undefined;
  rest: ChatMessage[];
} {
  const sysMsgs = messages.filter((m) => m.role === 'system');
  const sys = sysMsgs
    .map((m) => typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join(''))
    .join('\n\n');
  const cached = sysMsgs.some((m) => m.cacheBreakpoint === true);
  return {
    system: !sys ? undefined
      : cached ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }]
      : sys,
    rest: messages.filter((m) => m.role !== 'system'),
  };
}

export function toAnthropicMessages(messages: readonly ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // hoisted by splitSystem
    if (m.role === 'tool') {
      // tool results ride inside a user message as tool_result blocks
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId ?? '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          ...(m.cacheBreakpoint === true && { cache_control: { type: 'ephemeral' as const } }),
        }],
      });
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const blocks: Block[] = [];
    if (typeof m.content === 'string') {
      if (m.content) blocks.push({ type: 'text', text: m.content });
    } else {
      for (const p of m.content) {
        if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
        if (p.type === 'image' && p.imageUrl) {
          blocks.push({ type: 'image', source: { type: 'url', url: p.imageUrl } });
        }
      }
    }
    for (const tc of m.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
    }
    if (m.cacheBreakpoint === true && blocks.length > 0) {
      const last = blocks[blocks.length - 1]!;
      if (last.type !== 'image') last.cache_control = { type: 'ephemeral' };
    }
    out.push({ role, content: blocks.length ? blocks : '' });
  }
  return out;
}

export function toAnthropicTools(req: ChatRequest) {
  const tools = req.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  // A cache breakpoint on the last tool caches the whole tool list —
  // it precedes the volatile transcript in the prompt layout.
  if (req.cacheTools === true && tools?.length) {
    (tools[tools.length - 1] as { cache_control?: CacheControl }).cache_control = { type: 'ephemeral' };
  }
  return tools;
}

export function fromAnthropicStop(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'tool_use': return 'tool-calls';
    case 'max_tokens': return 'length';
    case 'refusal': return 'content-filter';
    default: return 'stop';
  }
}

export function parseAnthropicContent(blocks: readonly Block[] | undefined): { content: string; toolCalls?: ToolCall[] } {
  const text = (blocks ?? []).filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text).join('');
  const calls = (blocks ?? []).filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));
  return { content: text, ...(calls.length > 0 && { toolCalls: calls }) };
}
