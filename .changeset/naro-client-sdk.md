---
"@naro/client": minor
"@naro/cli": minor
---

New package `@naro/client`: a typed, zero-dependency, framework-agnostic
SDK for `naro serve`'s control-plane API — `NaroClient` (thin typed HTTP
wrappers) plus headless primitives (`watchRun`, `pollRuns`,
`pollApprovals`, each a plain `() => void` unsubscribe, no rendering
opinion — the split TanStack Query and Zag.js popularized). Works in Node
or a browser.

`naro serve`'s ops console (`GET /console`) is rewritten to be a
*reference implementation of this SDK* rather than a second, hand-rolled
implementation: it now imports `@naro/client` as a browser ES module
served directly from a new `GET /client/*.js` route (the compiled,
dependency-free `dist/` output — no bundler needed), and its primary
run view is now the evidence tree from the new `GET /runs/:id/evidence`
endpoint (`buildEvidence()`, correlated server-side) rather than a raw
event dump. Raw events remain available (collapsible), bounded to the
most recent 500 rendered rows rather than growing the DOM unboundedly.

Also new: `GET /runs/:id/events` accepts `?since=<seq>` to resume a
stream instead of re-replaying the whole journal on reconnect —
`watchRun` uses this automatically, reconnecting from the last-seen seq
on a dropped connection (thrown error, or the response simply ending
without a terminal event) rather than losing the cursor.

`RunSummary` (and `RunRegistry.list()`) gains an optional `traceId`,
implemented across `InMemoryRunRegistry`, `SqliteRunRegistry` (migrates
existing databases), and `@naro/adapter-pg`'s `PgRunRegistry`
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) — a run's delegation-tree
correlator, so `GET /runs?traceId=<id>` and the console's "show all runs
in this trace" list every run in one delegation tree, not just one.

Fixes a real bug this surfaced: `AgentRunner.run({runId})` without an
explicit `traceId` left `NaroEvent.traceId` pointing at the bus's
internally-generated runId instead of the caller-assigned one, breaking
the documented invariant that "a root run's traceId equals its own
runId" for every run submitted through `naro serve` (which always passes
an explicit `runId`).

`AgentRunner` also gains `history()`, a synchronous snapshot of events so
far — the same list `.run()` returns as `RunResult.events` at completion,
now readable mid-run (used by the new evidence endpoint).
