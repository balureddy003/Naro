import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Structural mirror of model's Model — no dep, no cycle. */
export interface ModelLike {
  readonly id: string;
  readonly provider: string;
  chat(request: {
    messages: readonly { role: string; content: unknown }[];
    tools?: readonly { name: string; description: string; parameters: object }[];
  }): Promise<{
    message: { role: string; content: unknown; toolCalls?: readonly { id: string; name: string; arguments: unknown }[] };
    finishReason: string;
  }>;
}

/**
 * The contract every Model must honor: chat returns an assistant message
 * and a known finishReason; when tools are offered and the model calls
 * one, the call carries id + name + arguments.
 */
export function modelProviderContract(name: string, make: () => ModelLike | Promise<ModelLike>): void {
  test(`${name}: chat returns an assistant message with a finishReason`, async () => {
    const m = await make();
    const res = await m.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.message.role, 'assistant');
    assert.ok(res.message.content !== undefined);
    assert.ok(['stop', 'tool-calls', 'length', 'content-filter', 'error'].includes(res.finishReason));
  });

  test(`${name}: provider identity is honest`, async () => {
    const m = await make();
    assert.ok(m.id.length > 0);
    assert.ok(m.provider.length > 0);
  });
}
