/**
 * playwright-core is an optional peer dependency — this shim lets the
 * package type-check without it installed. The real types apply when
 * the package is present.
 */
declare module 'playwright-core' {
  export const chromium: {
    launch(opts: { headless?: boolean }): Promise<{
      newPage(): Promise<{
        goto(url: string): Promise<unknown>;
        click(s: string): Promise<unknown>;
        fill(s: string, t: string): Promise<unknown>;
        title(): Promise<string>;
        url(): string;
        evaluate(fn: () => string): Promise<string>;
        $$eval(s: string, fn: (els: unknown[], arg?: string) => string[], arg?: string): Promise<string[]>;
        screenshot(opts: { type: 'png' }): Promise<Buffer>;
      }>;
      close(): Promise<void>;
    }>;
  };
}
