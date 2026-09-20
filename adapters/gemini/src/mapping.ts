import type { ChatMessage, FinishReason, ToolCall, ToolSpec } from '@naro/model';

/** Gemini wire shapes — generateContent v1beta. */

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Hoist system messages — Gemini takes them as systemInstruction. */
export function splitSystem(messages: readonly ChatMessage[]): {
  system?: string; rest: ChatMessage[];
} {
  const system = messages.filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  return { rest: messages.filter((m) => m.role !== 'system'), ...(system && { system }) };
}

export function toGeminiContents(messages: readonly ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // functionResponse pairs by NAME in Gemini — our toolCallId carries it
      // (gemini call ids are `name` or `name#i`).
      const name = (m.toolCallId ?? '').split('#')[0] ?? '';
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: textOf(m.content) } } }],
      });
      continue;
    }
    const parts: GeminiPart[] = [];
    if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'text' && p.text) parts.push({ text: p.text });
        // image parts → inlineData would go here (vision)
      }
    }
    for (const tc of m.toolCalls ?? []) {
      parts.push({ functionCall: { name: tc.name, args: (tc.arguments ?? {}) as Record<string, unknown> } });
    }
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return out;
}

export function toGeminiTools(tools: readonly ToolSpec[]): { functionDeclarations: object[] }[] | undefined {
  if (!tools.length) return undefined;
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name, description: t.description, parameters: t.parameters,
    })),
  }];
}

/** Gemini functionCall parts → provider-neutral tool calls. Ids are
 * name-based (`name`, `name#1`, …) since Gemini has no call ids —
 * functionResponse pairing is by name. */
export function fromGeminiParts(parts: readonly GeminiPart[]): {
  content: string; toolCalls?: ToolCall[];
} {
  const text = parts.filter((p) => p.text !== undefined).map((p) => p.text).join('');
  const calls = parts.filter((p) => p.functionCall);
  if (!calls.length) return { content: text };
  const seen = new Map<string, number>();
  return {
    content: text,
    toolCalls: calls.map((p) => {
      const name = p.functionCall!.name;
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      return { id: n === 0 ? name : `${name}#${n}`, name, arguments: p.functionCall!.args };
    }),
  };
}

export function fromGeminiFinish(reason?: string): FinishReason {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': case 'BLOCKLIST': case 'PROHIBITED_CONTENT': return 'content-filter';
    default: return 'stop';
  }
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.type === 'text' ? p.text ?? '' : '').join('');
  return JSON.stringify(content);
}
