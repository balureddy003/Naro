/**
 * The browser port: everything a web agent needs from "a browser",
 * nothing browser-specific in the environment itself.
 *
 * PlaywrightDriver is the real implementation (lazy-imported, optional
 * dep). Tests use in-file doubles. A CDP/Selenium/remote-browser driver
 * satisfies the same contract.
 */
export interface BrowserDriver {
  /** Navigate; returns the landed URL (post-redirect) and title. */
  goto(url: string): Promise<{ url: string; title: string }>;
  /** Click a CSS selector. */
  click(selector: string): Promise<void>;
  /** Type into a CSS selector. */
  type(selector: string, text: string): Promise<void>;
  /** Current URL + title + visible text (bounded). */
  pageState(): Promise<PageState>;
  /** Extract text/attr of all matches for a selector. */
  extract(selector: string, attr?: string): Promise<readonly string[]>;
  /** PNG bytes. */
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PageState {
  readonly url: string;
  readonly title: string;
  /** Visible text, already bounded by the driver. */
  readonly text: string;
}
