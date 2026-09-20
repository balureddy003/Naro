import type { ChatMessage, ChatRequest, FinishReason, ToolCall } from '@naro/model';

/**
 * Naro canonical ⇄ OpenAI wire format. This is the entire adapter's job:
 * translate faithfully, leak nothing provider-specific into the core types.
 */

interface OaiMessage {
  role: string;
  content?: string | unknown[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export function toOaiMessages(messages: readonly ChatMessage[]): OaiMessage[] {
  return messages.map((m) => {
    const o: OaiMessage = { role: m.role };
    o.content = typeof m.content === 'string'
      ? m.content
      : m.content.map((p) => p.type === 'text'
          ? { type: 'text', text: p.text ?? '' }
          : { type: 'image_url', image_url: { url: p.imageUrl } });
    if (m.toolCalls?.length) {
      o.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id, type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      }));
    }
    if (m.toolCallId) o.tool_call_id = m.toolCallId;
    if (m.name) o.name = m.name;
    return o;
  });
}

export function toOaiTools(req: ChatRequest) {
  return req.tools?.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toOaiResponseFormat(req: ChatRequest) {
  if (req.responseFormat === 'json') return { type: 'json_object' };
  if (typeof req.responseFormat === 'object' && req.responseFormat.type === 'schema') {
    return { type: 'json_schema', json_schema: { name: 'output', schema: req.responseFormat.schema } };
  }
  return undefined;
}

export function fromOaiFinish(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'tool_calls': return 'tool-calls';
    case 'length': return 'length';
    case 'content_filter': return 'content-filter';
    case 'stop': default: return 'stop';
  }
}

export function fromOaiToolCalls(
  calls: { id: string; function: { name: string; arguments: string } }[] | undefined,
): ToolCall[] | undefined {
  return calls?.map((c) => {
    let args: unknown = {};
    try { args = JSON.parse(c.function.arguments); } catch { /* malformed args stay {} */ }
    return { id: c.id, name: c.function.name, arguments: args };
  });
}
