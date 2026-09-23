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

  async submitGoal(input: { description: string; successCriteria?: readonly string[]; idempotencyKey?: string }): Promise<{ runId: string; status?: string; deduplicated?: boolean }> {
    return this.request('POST', '/goals', input);
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

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
