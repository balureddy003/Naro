# @naro/profile-browser

A web agent's world: one browser session behind a `BrowserDriver` port.

## The port

`BrowserEnvironment` implements `Environment` against `BrowserDriver` — `goto / click / type / extract / pageState / screenshot`. The environment knows nothing about Playwright; the driver knows nothing about agents.

## Drivers

- **`PlaywrightDriver`** — real Chromium via `playwright-core`, an **optional peer dep**: the package installs and type-checks without it; `launch()` throws a clear error if it's missing (`npm i playwright-core && npx playwright install chromium`).
- Test doubles satisfy the same contract — the shipped tests run with zero browser.

## Capabilities

`browser.goto · click · type · extract · read · screenshot` — matched against `action.capability`, so policy can gate navigation separately from interaction.

## Security posture

- **Domain allowlist enforced inside the environment** — policy gates the capability, the env gates the destination (same defense-in-depth as research's `net.fetch`).
- Page content is untrusted — observations carry provenance; prompt layers must delimit it.
- `state()` exposes `{url, title}` — not the full DOM (that's `browser.read`'s job).

## Usage

```ts
const driver = await PlaywrightDriver.launch({ headless: true });
const env = new BrowserEnvironment({ driver, allowedDomains: ['docs.example.com'] });
```
