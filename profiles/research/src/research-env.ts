import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import { boundedText, fetchAllowlisted, type Environment, type EnvironmentState } from '@naro/environment';

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
  /**
   * Allow fetching private/loopback addresses (dev only). Default false —
   * an allowlisted host that resolves to 169.254.169.254 is refused.
   */
  readonly allowPrivateHosts?: boolean;
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
    // Every redirect hop is revalidated by fetchAllowlisted — an allowed
    // domain redirecting to a private address is refused, not followed.
    const res = await fetchAllowlisted(url, {
      allowedDomains: this.opts.allowedDomains,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
      allowPrivateHosts: this.opts.allowPrivateHosts ?? false,
    });
    const { text, truncated } = await boundedText(res, this.opts.maxBytes);
    const landed = res.url || url;
    const page: Page = {
      url: landed, status: res.status, bytes: text.length,
      truncated, content: text,
    };
    this.pages.set(url, page);
    this.pages.set(landed, page);
    // Fetched content is authored outside the system — external trust.
    return this.obs(action, res.ok, {
      url, status: res.status, bytes: page.bytes,
      ...(page.truncated && { truncated: true }),
      content: page.content,
    }, res.ok ? undefined : `HTTP ${res.status}`, 'external');
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

  private obs(action: Action, success: boolean, output?: unknown, error?: string,
              trust?: Observation['trust']): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success,
      ...(trust !== undefined && { trust }),
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
    });
  }
}
