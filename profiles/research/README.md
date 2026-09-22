# @naro/profile-research

A researcher's world: fetched pages + citations. Proof that retrieval, provenance, and citation are *profile* concerns.

## The world

- **`net.fetch`** — GET an allowlisted URL. Content lands as a provenance-marked page (bounded bytes, explicit truncation). The allowlist is enforced *inside* the environment — defense in depth: policy gates the capability, the environment gates the destination.
- **`cite.add`** — record `{url, claim}`. **Refuses URLs that were never fetched** — you cite evidence, not imagination.
- **`cite.list`** — the citation trail.

`state()` exposes fetched pages + citations as observable resources.

## Tools

`researchTools(env)` → `web_fetch`, `add_citation`, `list_citations` — standard tools through the standard pipeline.

## Invariants

- http/https only; no `file:`, no redirects to non-allowlisted hosts (the allowlist checks the URL you hand it — redirects are the fetch layer's concern; pin `redirect: 'error'` if your threat model requires).
- Fetch is injectable — tests assert wire behavior offline.
- `web_fetch` / `net.fetch` observations carry `trust: 'external'` — the transcript builder delimits them automatically (`UNTRUSTED OUTPUT` banner), and `createToolPolicy({ denyExternalTriggered })` can refuse side effects triggered by fetched content. `createToolPolicy` only gates `tool://` targets; agents driving `env://research/...` directly need a capability rule such as `denyCapability` from `@naro/policy` (see `docs/learn/06` and `11`). Runnable: `npm run example:research`.
