import { newId } from '@naro/core';
import type { Goal } from '@naro/core';

/**
 * A2A seam: agents address each other by id over a bus. The bus is a
 * replaceable contract — in-process today, A2A/HTTP/gRPC adapter later.
 * Naro's kernel stays single-agent; coordination is a tool problem.
 */

export interface AgentDescriptor {
  readonly id: string;
  readonly name: string;
  /** What this agent is good at — used for routing/delegation decisions. */
  readonly capabilities: readonly string[];
}

export type AgentMessage =
  | { readonly kind: 'task-request'; readonly id: string; readonly from: string; readonly goal: Goal; readonly at: number }
  | { readonly kind: 'task-result'; readonly id: string; readonly requestId: string; readonly from: string; readonly ok: boolean; readonly result?: unknown; readonly error?: string; readonly at: number }
  | { readonly kind: 'status'; readonly id: string; readonly from: string; readonly state: string; readonly at: number };

export interface AgentBus {
  /** Register a handler that receives task requests addressed to `agentId`. */
  serve(agentId: string, handler: (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>): void;
  /** Send a task request and await the result. */
  request(to: string, goal: Goal, from: string, timeoutMs?: number): Promise<unknown>;
}

export class InMemoryAgentBus implements AgentBus {
  private readonly handlers = new Map<string, (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>>();

  serve(agentId: string, handler: (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>): void {
    this.handlers.set(agentId, handler);
  }

  async request(to: string, goal: Goal, from: string, timeoutMs = 30_000): Promise<unknown> {
    const handler = this.handlers.get(to);
    if (!handler) throw new Error(`no agent registered as '${to}'`);
    const msg: Extract<AgentMessage, { kind: 'task-request' }> = {
      kind: 'task-request', id: newId('msg'), from, goal, at: Date.now(),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        handler(msg),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`agent '${to}' timed out`)), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Who can be delegated to — a directory the reasoner or a tool can query. */
export class AgentDirectory {
  private readonly agents = new Map<string, AgentDescriptor>();
  register(d: AgentDescriptor): void { this.agents.set(d.id, d); }
  get(id: string): AgentDescriptor | undefined { return this.agents.get(id); }
  list(): readonly AgentDescriptor[] { return [...this.agents.values()]; }
  /** Find agents advertising a capability. */
  find(capability: string): readonly AgentDescriptor[] {
    return this.list().filter((a) => a.capabilities.includes(capability));
  }
}
