/**
 * Wire types for `naro serve`'s control-plane API — deliberately
 * self-contained rather than imported from `@naro/core`/`@naro/runtime`.
 * This package describes the HTTP/JSON contract those packages happen to
 * produce today, not their internal types: a browser consumer installs
 * `@naro/client` alone, never the agent kernel it talks to. Kept in sync
 * by hand with `runtime/src/run-registry.ts`, `runtime/src/approvals.ts`,
 * `core/src/events.ts`, and `observability/src/evidence.ts` — the same
 * discipline a client SDK for any HTTP API applies to its server.
 */

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface RunSummary {
  readonly runId: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly goal: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly result?: unknown;
  readonly error?: string;
  readonly host?: string;
  readonly tenantId?: string;
  /** This run's delegation-tree correlator — a root run's traceId equals
   *  its own runId; a delegated child's matches its parent's. */
  readonly traceId?: string;
}

/** Loosely typed on purpose: a generic client renders `type`/`data` without
 *  needing the full discriminated union `@naro/core`'s NaroEvent is. */
export interface RunEvent {
  readonly id: string;
  readonly type: string;
  readonly seq: number;
  readonly at: number;
  readonly agentId: string;
  readonly goalId: string;
  readonly runId: string;
  readonly traceId?: string;
  readonly data: Record<string, unknown>;
  readonly prev?: string;
  readonly hash?: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: 'approve' | 'ask';
  readonly question: string;
  readonly action?: { readonly capability: string; readonly target: string; readonly input: unknown };
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly answeredBy?: string;
  readonly answer?: { readonly approved?: boolean; readonly text?: string; readonly note?: string; readonly at: number };
}

export interface ActionEvidence {
  readonly actionId: string;
  readonly capability: string;
  readonly policy: 'permitted' | 'approved' | 'denied' | 'unresolved';
  readonly policyEngine?: string;
  readonly approvedBy?: string;
  readonly deniedReason?: string;
  readonly executed: boolean;
  readonly observation?: { readonly success: boolean; readonly kind: string; readonly source: string; readonly error?: string };
  readonly verification?: { readonly ok: boolean; readonly verifier?: string; readonly reason?: string };
}

export interface EvidenceRecord {
  readonly runId?: string;
  readonly agentId?: string;
  readonly events: number;
  readonly chain: {
    readonly ok: boolean;
    readonly length: number;
    readonly head?: string;
    readonly brokenAt?: number;
    readonly reason?: string;
    readonly unchained: number;
    readonly sealed?: { readonly ok: boolean; readonly publicKey?: string; readonly reason?: string };
  };
  readonly actions: readonly ActionEvidence[];
  readonly goalVerification?: { readonly ok: boolean; readonly verifier?: string; readonly reason?: string };
  readonly outcome?: { readonly status: 'completed' | 'failed' | 'cancelled' | 'paused'; readonly detail?: string };
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; readonly costUsd?: number };
  readonly counts: { readonly actions: number; readonly denied: number; readonly verificationFailures: number };
}
