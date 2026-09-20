import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';
import type { BrowserDriver } from './driver.ts';

/**
 * A web agent's world: one browser session.
 *
 * Capabilities:
 *   browser.goto       — navigate; input {url} (allowlisted)
 *   browser.click      — input {selector}
 *   browser.type       — input {selector, text}
 *   browser.extract    — input {selector, attr?}
 *   browser.read       — current page state (url/title/text)
 *   browser.screenshot — PNG bytes (base64 in the observation)
 *
 * Everything the browser returns is untrusted page content — the
 * observation records provenance; prompt layers must delimit it.
 * Navigation is allowlisted inside the environment, like research's
 * net.fetch: policy gates the capability, the env gates destinations.
 */
export interface BrowserEnvOptions {
  readonly driver: BrowserDriver;
  readonly allowedDomains: readonly string[];
}

export class BrowserEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = [
    'browser.goto', 'browser.click', 'browser.type',
    'browser.extract', 'browser.read', 'browser.screenshot',
  ];
  private readonly driver: BrowserDriver;
  private readonly allowed: readonly string[];

  constructor(opts: BrowserEnvOptions, id = 'browser') {
    this.driver = opts.driver;
    this.allowed = opts.allowedDomains;
    this.id = id;
  }

  async state(): Promise<EnvironmentState> {
    const p = await this.driver.pageState();
    return { at: Date.now(), resources: { page: { url: p.url, title: p.title } } };
  }

  async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    const input = (action.input ?? {}) as Record<string, unknown>;
    try {
      switch (action.capability) {
        case 'browser.goto': {
          const url = String(input['url'] ?? '');
          const deny = this.checkUrl(url);
          if (deny) return this.obs(action, false, undefined, deny);
          const landed = await this.driver.goto(url);
          // The page may have redirected — the LANDED url must pass too.
          const landedUrl = (landed as { url?: string } | undefined)?.url;
          const post = landedUrl ? this.checkUrl(landedUrl) : undefined;
          if (post) return this.obs(action, false, undefined, `redirect blocked: ${post}`);
          return this.obs(action, true, landed);
        }
        case 'browser.click': {
          await this.driver.click(String(input['selector'] ?? ''));
          // Clicks can navigate — re-validate where we ended up.
          const post = await this.checkCurrentPage();
          if (post) return this.obs(action, false, undefined, post);
          return this.obs(action, true, { clicked: input['selector'] });
        }
        case 'browser.type': {
          await this.driver.type(String(input['selector'] ?? ''), String(input['text'] ?? ''));
          const post = await this.checkCurrentPage();
          if (post) return this.obs(action, false, undefined, post);
          return this.obs(action, true, { typed: input['selector'] });
        }
        case 'browser.extract': {
          const vals = await this.driver.extract(
            String(input['selector'] ?? ''),
            input['attr'] === undefined ? undefined : String(input['attr']),
          );
          return this.obs(action, true, vals);
        }
        case 'browser.read':
          return this.obs(action, true, await this.driver.pageState());
        case 'browser.screenshot': {
          const png = await this.driver.screenshot();
          return this.obs(action, true, { pngBase64: Buffer.from(png).toString('base64') });
        }
        default:
          return this.obs(action, false, undefined,
            `environment '${this.id}' does not support capability '${action.capability}'`);
      }
    } catch (e) {
      return this.obs(action, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /** Where are we NOW? Any client-side navigation must stay allowlisted. */
  private async checkCurrentPage(): Promise<string | undefined> {
    const p = await this.driver.pageState().catch(() => undefined);
    if (!p?.url || !['http:', 'https:'].some((s) => p.url.startsWith(s))) return undefined;
    const deny = this.checkUrl(p.url);
    return deny ? `navigation left the allowlist: ${deny}` : undefined;
  }

  private checkUrl(url: string): string | undefined {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return `invalid URL '${url}'`; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return `protocol '${parsed.protocol}' not allowed`;
    if (!this.allowed.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return `domain '${parsed.hostname}' not in allowlist`;
    }
    return undefined;
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
