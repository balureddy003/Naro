import type { ApprovalRequest, EvidenceRecord, RunEvent, RunSummary } from './types.ts';

export interface NaroClientOptions {
  /** e.g. 'http://localhost:8080'. No trailing slash required. */
  readonly baseUrl: string;
  /** Bearer token, if `naro serve` has `--token`/`--principals` configured. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

export class NaroApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NaroApiError';
    this.status = status;
  }
}

/**
 * A typed, zero-dependency client for `naro serve`'s control-plane API —
 * the one seam every UI (the included console, a custom dashboard, a CLI,
 * a Slack bot) should go through instead of hand-rolling `fetch` calls
 * against the HTTP endpoints. Works in Node or a browser: no Node-only
 * APIs, no bundler-specific assumptions, nothing beyond `fetch` and
 * `AbortController`.
 */
export class NaroClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: NaroClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    // Bound, not a bare reference: a browser's native fetch is a WebIDL
    // method that requires `this` to be `window`/`self`, so capturing the
    // global function and calling it later as `this.fetchImpl(...)`
    // throws "Illegal invocation" there — Node's fetch tolerates an
    // unbound call, which is why this only surfaces in a real browser.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async submitGoal(input: { description: string; successCriteria?: readonly string[]; idempotencyKey?: string; template?: string }): Promise<{ runId: string; status?: string; deduplicated?: boolean }> {
    return this.request('POST', '/goals', input);
  }

  /** ADR 0026: the caller's own identity + effective roles — what a UI
   *  renders against when deciding which surfaces are visible. */
  async me(): Promise<{ id: string; roles: readonly string[]; tenantId?: string; open?: boolean }> {
    return this.request('GET', '/me');
  }

  /** ADR 0022: stop one run. `reason` is required server-side. */
  async cancelRun(runId: string, reason: string): Promise<{ ok: boolean; runId: string; status: string }> {
    return this.request('POST', `/runs/${encodeURIComponent(runId)}/cancel`, { reason });
  }

  /** ADR 0022: fleet-wide halt — admin only. */
  async cancelAllRuns(reason: string): Promise<{ ok: boolean; cancelled: number }> {
    return this.request('POST', '/runs/cancel-all', { reason });
  }

  // ---- ADR 0024: admin surface ----

  async listToolCollisions(): Promise<readonly { name: string; heldBy?: string; claimedBy: string }[]> {
    return this.request('GET', '/admin/tool-collisions');
  }

  async resolveToolCollision(name: string, sourceId: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/admin/tool-collisions/resolve', { name, sourceId });
  }

  async listChangedDefinitions(): Promise<readonly { name: string; sourceId: string; previous: string; current: string }[]> {
    return this.request('GET', '/admin/tool-definitions/changed');
  }

  async acknowledgeDefinition(name: string, sourceId?: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/admin/tool-definitions/acknowledge', { name, ...(sourceId !== undefined && { sourceId }) });
  }

  /** ADR 0018 via ADR 0024: attested retention prune. `policy` is the
   *  justification recorded on the journal.retention.pruned marker. */
  async pruneRun(runId: string, throughSeq: number, policy?: string): Promise<{ ok: boolean; pruned: number; anchorHash: string }> {
    return this.request('POST', `/admin/runs/${encodeURIComponent(runId)}/prune`, { throughSeq, ...(policy !== undefined && { policy }) });
  }

  // ---- ADR 0025: live principal administration ----

  async listPrincipals(): Promise<readonly { id: string; roles: readonly string[]; tenantId?: string; tokenLast4: string; createdAt: number }[]> {
    return this.request('GET', '/admin/principals');
  }

  /** Returns the raw token exactly once — the server stores only its
   *  hash + last-4, so this response is the only place it exists. */
  async createPrincipal(input: { id?: string; roles: readonly string[]; tenantId?: string }): Promise<{ token: string; id: string; roles: readonly string[]; tenantId?: string }> {
    return this.request('POST', '/admin/principals', input);
  }

  async revokePrincipal(id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/admin/principals/${encodeURIComponent(id)}`);
  }

  /** `traceId` restricts to one delegation tree — see `RunSummary.traceId`. */
  async listRuns(opts: { traceId?: string } = {}): Promise<readonly RunSummary[]> {
    const query = opts.traceId !== undefined ? `?traceId=${encodeURIComponent(opts.traceId)}` : '';
    return this.request('GET', `/runs${query}`);
  }

  async getRun(runId: string): Promise<RunSummary> {
    return this.request('GET', `/runs/${encodeURIComponent(runId)}`);
  }

  /** `buildEvidence()` computed server-side — the correlated policy →
   *  action → observation → verifier tree, not raw events a client
   *  would otherwise have to re-derive itself. */
  async getEvidence(runId: string): Promise<EvidenceRecord> {
    return this.request('GET', `/runs/${encodeURIComponent(runId)}/evidence`);
  }

  async listApprovals(): Promise<readonly ApprovalRequest[]> {
    return this.request('GET', '/approvals');
  }

  async answerApproval(id: string, answer: { approved?: boolean; text?: string; note?: string }): Promise<{ ok: boolean }> {
    return this.request('POST', `/approvals/${encodeURIComponent(id)}`, answer);
  }

  /**
   * The run's event stream as an async iterable of parsed `RunEvent`s —
   * hand-rolled SSE parsing over an authenticated `fetch`, not the
   * browser's `EventSource` (which cannot set an `Authorization` header;
   * a token in the URL would leak into logs and history). Pass `since` to
   * resume after a seq you've already seen instead of replaying the
   * whole journal (see `?since=` on `GET /runs/:id/events`).
   */
  async *streamEvents(runId: string, opts: { since?: number; signal?: AbortSignal } = {}): AsyncIterable<RunEvent> {
    const query = opts.since !== undefined ? `?since=${opts.since}` : '';
    const res = await this.fetchImpl(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/events${query}`, {
      headers: this.headers(), ...(opts.signal !== undefined && { signal: opts.signal }),
    });
    if (!res.ok || !res.body) throw new NaroApiError(res.status, `events: ${res.status} ${await safeText(res)}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          yield JSON.parse(line.slice(5)) as RunEvent;
        } catch {
          // A malformed line is dropped, not fatal to the stream — the
          // hash chain (naro verify) is the source of truth for
          // integrity, not this best-effort live tail.
        }
      }
    }
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { ...this.headers(), 'content-type': 'application/json' } : this.headers(),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new NaroApiError(res.status, await safeText(res));
    return res.json() as Promise<T>;
  }

  private headers(): Record<string, string> {
    return this.token !== undefined ? { authorization: `Bearer ${this.token}` } : {};
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return res.statusText; }
}
