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

type Block = { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string } };

interface AnthropicMessage { role: 'user' | 'assistant'; content: string | Block[] }

export function splitSystem(messages: readonly ChatMessage[]): { system: string | undefined; rest: ChatMessage[] } {
  const sys = messages.filter((m) => m.role === 'system')
    .map((m) => typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join(''))
    .join('\n\n');
  return {
    system: sys || undefined,
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
    out.push({ role, content: blocks.length ? blocks : '' });
  }
  return out;
}

export function toAnthropicTools(req: ChatRequest) {
  return req.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
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
