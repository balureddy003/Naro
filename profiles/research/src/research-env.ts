import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';

/**
 * A researcher's world: fetched pages and citations.
 *
 * The point of a domain profile: 'net.fetch' and 'cite' are research
 * concepts — they don't belong in the kernel, but they do belong in a
 * reusable profile. Fetched content is *untrusted*: it lands in
 * resources with provenance, and the environment itself enforces the
 * domain allowlist (defense in depth — policy gates the capability,
 * the environment enforces the destination).
 *
 * Capabilities:
 *   net.fetch  — GET a URL; target env://<id>/fetch, input {url}
 *   cite.add   — record {url, claim};        target env://<id>/cite
 *   cite.list  — list citations;             target env://<id>/cite
 */

export interface ResearchOptions {
  /** Hostnames the agent may fetch — enforced inside the environment. */
  readonly allowedDomains: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

export interface Citation {
  readonly url: string;
  readonly claim: string;
  readonly at: number;
}

interface Page {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

export class ResearchEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['net.fetch', 'cite.add', 'cite.list'];
  private readonly opts: Required<Pick<ResearchOptions, 'maxBytes' | 'timeoutMs'>> & ResearchOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly pages = new Map<string, Page>();
  private readonly citations: Citation[] = [];

  constructor(opts: ResearchOptions, id = 'research') {
    this.opts = { maxBytes: 64_000, timeoutMs: 15_000, ...opts };
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.id = id;
  }

  state(): EnvironmentState {
    return {
      at: Date.now(),
      resources: {
        pages: [...this.pages.keys()],
        citations: [...this.citations],
      },
    };
  }

  async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    try {
      switch (action.capability) {
        case 'net.fetch': return await this.fetchPage(action);
        case 'cite.add':  return this.addCitation(action);
        case 'cite.list': return this.obs(action, true, [...this.citations]);
        default:
          return this.obs(action, false, undefined,
            `environment '${this.id}' does not support capability '${action.capability}'`);
      }
    } catch (e) {
      return this.obs(action, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private async fetchPage(action: Action): Promise<Observation> {
    const url = String((action.input as { url?: unknown })?.url ?? '');
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return this.obs(action, false, undefined, `invalid URL '${url}'`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return this.obs(action, false, undefined, `protocol '${parsed.protocol}' not allowed`);
    }
    if (!this.opts.allowedDomains.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return this.obs(action, false, undefined,
        `domain '${parsed.hostname}' not in allowlist (${this.opts.allowedDomains.join(', ') || 'empty'})`);
    }
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.opts.timeoutMs) });
    const text = (await res.text()).slice(0, this.opts.maxBytes);
    const page: Page = {
      url, status: res.status, bytes: text.length,
      truncated: text.length >= this.opts.maxBytes, content: text,
    };
    this.pages.set(url, page);
    return this.obs(action, res.ok, {
      url, status: res.status, bytes: page.bytes,
      ...(page.truncated && { truncated: true }),
      content: page.content,
    }, res.ok ? undefined : `HTTP ${res.status}`);
  }

  private addCitation(action: Action): Observation {
    const { url, claim } = (action.input ?? {}) as { url?: string; claim?: string };
    if (!url || !claim) return this.obs(action, false, undefined, 'cite.add requires {url, claim}');
    if (!this.pages.has(url)) {
      return this.obs(action, false, undefined,
        `cannot cite '${url}' — not fetched (cite evidence, not imagination)`);
    }
    const c: Citation = { url, claim, at: Date.now() };
    this.citations.push(c);
    return this.obs(action, true, c);
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success,
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
    });
  }
}
