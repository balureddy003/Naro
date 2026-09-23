# @naro/client

A typed, zero-dependency, framework-agnostic client for `naro serve`'s
control-plane API — the one seam any UI should go through instead of
hand-rolling `fetch` calls. Works in Node or a browser: nothing here beyond
`fetch`, `AbortController`, and `ReadableStream`, all of which come from
the runtime, not from Naro.

This is the SDK layer behind `naro serve`'s built-in ops console
(`GET /console`) — that page is a reference implementation *of* this
package, not a separate thing. Build your own dashboard on the same client
if the included console isn't what you want.

## Design

Two layers, on purpose — the split TanStack Query and Zag.js popularized
("the library runs the state machine, your UI decides what it looks
like"):

- **`NaroClient`** — thin typed wrappers over the HTTP endpoints:
  `submitGoal`, `listRuns`, `getRun`, `getEvidence`, `listApprovals`,
  `answerApproval`, `streamEvents`. No caching, no state, no opinions about
  re-render — call it, get a typed value or a `NaroApiError`.
- **Headless primitives** (`headless.ts`) — `watchRun`, `pollRuns`,
  `pollApprovals`. Each takes a callback and returns a plain `() => void`
  unsubscribe. No React, no store, no rendering — wire the callback into
  whatever state layer your app already has.

## Usage

```ts
import { NaroClient, watchRun, pollApprovals } from '@naro/client';

const client = new NaroClient({ baseUrl: 'http://localhost:8080', token: myToken });

const { runId } = await client.submitGoal({ description: 'do the thing' });

const stopWatching = watchRun(client, runId, {
  onEvent: (e) => console.log(e.seq, e.type, e.data),
  onError: (err) => console.warn('reconnecting after', err),
});

const stopPolling = pollApprovals(client, {
  intervalMs: 3000,
  onData: (approvals) => renderQueue(approvals),
});
```

## `getEvidence` vs. raw events

`getEvidence(runId)` returns the same `EvidenceRecord` `naro verify`
computes offline — policy verdict → action → observation → verifier,
correlated server-side by `buildEvidence()`. Prefer it over reconstructing
that correlation from `streamEvents()` yourself; the server already did
the work, and the pairing rules (which `verification.completed` answers
which action, matching approvals to their actions, …) are exactly the kind
of logic that's easy to get subtly wrong twice.

## `watchRun` and resumable streaming

`GET /runs/:id/events` accepts `?since=<seq>` to resume after a seq you've
already seen instead of re-replaying the whole journal. `watchRun` uses
this automatically: on a dropped connection — a thrown error, or the HTTP
response simply ending without a terminal event (network blip, proxy
timeout, server restart) — it reconnects from the last-seen seq rather
than losing the cursor or replaying from zero. It only stops on its own
once it actually sees a terminal event (`agent.completed`/`failed`/
`cancelled`/`paused`).

## Wire types, not server types

`types.ts` defines `RunSummary`, `RunEvent`, `ApprovalRequest`, and
`EvidenceRecord` locally rather than importing `@naro/core`/
`@naro/runtime`/`@naro/observability`. A client SDK describes the HTTP/JSON
contract its server happens to produce, not the server's internal types —
a browser page installs `@naro/client` alone, never the agent kernel it
talks to. Kept in sync by hand with `runtime/src/run-registry.ts`,
`runtime/src/approvals.ts`, `core/src/events.ts`, and
`observability/src/evidence.ts`.

## Failure behavior

- a non-2xx HTTP response throws `NaroApiError` (carries `.status`);
- a malformed SSE line is dropped, not fatal to the stream — the hash
  chain (`naro verify`) is the source of truth for integrity, not a live
  tail's best-effort parsing;
- `fetchImpl` is injectable — tests run offline against canned responses,
  the same pattern as this repo's other HTTP-based adapters.
