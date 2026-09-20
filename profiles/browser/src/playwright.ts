import type { BrowserDriver, PageState } from './driver.ts';

/**
 * Real browser via playwright-core — an OPTIONAL peer dependency.
 * Import cost is deferred: this module loads playwright only when
 * PlaywrightDriver.launch() is called, so the package installs and
 * type-checks without a browser on the machine.
 *
 *   npm i playwright-core && npx playwright install chromium
 */
export class PlaywrightDriver implements BrowserDriver {
  private constructor(private readonly page: {
    goto(url: string): Promise<unknown>;
    click(s: string): Promise<unknown>;
    fill(s: string, t: string): Promise<unknown>;
    title(): Promise<string>;
    url(): string;
    evaluate(fn: () => string): Promise<string>;
    $$eval(s: string, fn: (els: unknown[], arg?: string) => string[], arg?: string): Promise<string[]>;
    screenshot(opts: { type: 'png' }): Promise<Buffer>;
  }, private readonly closeBrowser: () => Promise<void>, private readonly maxText: number) {}

  static async launch(opts: { headless?: boolean; maxTextChars?: number } = {}): Promise<PlaywrightDriver> {
    let pw: { chromium: { launch(o: { headless: boolean }): Promise<{ newPage(): Promise<never>; close(): Promise<void> }> } };
    try {
      pw = await import('playwright-core') as never;
    } catch {
      throw new Error('playwright-core not installed — npm i playwright-core && npx playwright install chromium');
    }
    const browser = await pw.chromium.launch({ headless: opts.headless ?? true });
    const page = await browser.newPage();
    return new PlaywrightDriver(page as never, () => browser.close(), opts.maxTextChars ?? 8_000);
  }

  async goto(url: string) {
    await this.page.goto(url);
    return { url: this.page.url(), title: await this.page.title() };
  }
  async click(selector: string) { await this.page.click(selector); }
  async type(selector: string, text: string) { await this.page.fill(selector, text); }
  async extract(selector: string, attr?: string) {
    return this.page.$$eval(selector,
      (els: unknown[], a?: string) => els.map((e) => a ? String((e as Record<string, unknown>)[a] ?? '') : (e as { textContent?: string }).textContent ?? ''),
      attr);
  }
  async pageState(): Promise<PageState> {
    const text = await this.page.evaluate(() => (globalThis as { document?: { body?: { innerText?: string } } }).document?.body?.innerText ?? '');
    return { url: this.page.url(), title: await this.page.title(), text: text.slice(0, this.maxText) };
  }
  async screenshot() { return new Uint8Array(await this.page.screenshot({ type: 'png' })); }
  async close() { await this.closeBrowser(); }
}
