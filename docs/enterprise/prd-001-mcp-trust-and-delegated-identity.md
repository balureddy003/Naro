# PRD-001 — MCP Trust and Delegated Identity

Status: proposed
Owner: unassigned
Depends on: [ADR 0015](../adr/0015-mcp-server-calls-route-through-the-harness-gate.md), [ADR 0016](../adr/0016-tool-definitions-are-provenance-pinned.md), [ADR 0017](../adr/0017-delegated-principal-is-a-policy-input.md)

## Summary

Package three kernel decisions — MCP calls gated symmetrically in both
directions, tool *definitions* provenance-pinned against poisoning and
rug pulls, and delegated principal identity reaching the policy gate —
into one shippable capability: an operator can point Naro at any MCP
server, in either role, and get the same structural guarantees Naro
already gives local tools, attributable to a specific identity, with a
detectable alert if a trusted tool's contract changes underneath them.

## Problem

MCP adoption is now the default way agents reach tools, and its security
posture is a known, current problem, not a theoretical one: independent
2026 scans find that a majority of public MCP servers carry exploitable
flaws, and named attack patterns — tool poisoning (a malicious
description read as trusted context before any action runs) and rug
pulls (a previously-approved tool's contract changing unnoticed) — are
documented by national security guidance, not just security vendors.
`@naro/adapter-mcp` already exists and already does real work (tool
*output* is provenance-tagged per ADR 0010), but three gaps sit between
"Naro has an MCP adapter" and "an enterprise buyer can trust it":

1. Naro's own tools, served *to* an MCP host, bypass the policy gate
   entirely (ADR 0015) — the inbound direction has none of the
   guarantees the outbound direction does.
2. A tool's *description and schema*, not just its output, can be
   malicious or can change without notice, and nothing detects either
   (ADR 0016).
3. Every action inside a run is attributed to "this agent," never to the
   specific human or service principal it's acting for (ADR 0017) — an
   auditor asking "who authorized this specific call" gets an agent id,
   not an identity.

Each gap is real on its own; together they're the difference between "we
have an MCP adapter" and "we can show you the evidence trail an MCP-heavy
deployment needs."

## Goals

- Every MCP call, in either direction, passes the same policy gate and
  produces the same journal shape as a local tool call — no asymmetry
  between `McpToolSource` and `McpRegistryServer`.
- A tool sourced from an untrusted MCP server whose definition changes
  between approvals is caught structurally, not by an operator happening
  to notice — `naro verify`/`buildEvidence` can show exactly which tools
  were pinned, when, and whether any changed.
- Every action taken through this path is attributable to a specific
  delegated principal, not only an agent id — an auditor can answer "who
  authorized this" without cross-referencing a separate system.
- None of this requires Naro to become an identity provider or an OAuth
  implementation — the gateway/control plane resolves identity; Naro's
  job is giving it a seat at the gate that already exists.

## Non-goals

- Building an MCP server security scanner or vulnerability database.
  This PRD makes Naro's *own* governance of MCP calls sound; it does not
  audit third-party MCP servers' code.
- Implementing XAA, OAuth 2.1, or any specific delegated-auth protocol.
  ADR 0017 gives `principal` a seat at the policy gate; wiring an actual
  XAA/OIDC token exchange into a credential-selection adapter is real,
  separate follow-up work this PRD does not scope.
- Retroactively re-verifying every historical Naro deployment's MCP
  usage. This ships forward; it does not audit past runs.

## Users and scenario

**Primary user:** a platform or security engineer at an organization
already running MCP servers in production (per the 2026 data, most
Fortune 500 companies now do), evaluating whether to put an agent runtime
in front of them.

**Scenario:** the organization connects a Naro-driven agent to an
internal MCP server (a database tool, a deploy tool) and exposes some of
its own tools back over MCP to a coding assistant a different team uses.
Six months later, a security review asks: "for every write action this
agent took through MCP, who authorized it, under what tool contract, and
can you prove none of the tool definitions changed underneath the
approval?" This PRD is what makes that a `naro verify --json` query
instead of an unanswerable question.

## Functional requirements

1. **`McpRegistryServer` requires a `HarnessKernel`** (or equivalent
   policy-gated path) per ADR 0015 — no code path where an MCP host
   invokes a Naro tool without a policy verdict and a journaled
   observation.
2. **`ToolRegistry` computes and persists `definitionHash` per tool per
   source** per ADR 0016, and a changed hash forces re-approval by
   default under `createToolPolicy` regardless of the tool's prior
   side-effect classification.
3. **`toolSourceContract` (`@naro/contract-tests`) gains an assertion**
   that a `ToolSource` reporting `trust: 'external'` also computes a
   `definitionHash` — a source implementation that skips this fails the
   shared suite, not just a manual review.
4. **`PolicyContext.principal` is populated end-to-end** per ADR 0017
   when `naro serve` submits a goal on behalf of an authenticated
   principal, and `buildEvidence()`'s per-action record surfaces it
   alongside the existing `policyEngine`/`approver` fields.
5. **The console/evidence tree shows all three** — a per-action badge for
   "tool definition unchanged since approval" vs. "changed, re-approved
   on <date>," and the acting principal, not just the agent id. Small
   addition to existing evidence-card rendering (`@naro/client`), not a
   new surface.

## Success metrics

Measured against a real MCP-backed scenario (a Naro agent talking to a
locally-run reference MCP server, per `@naro/adapter-mcp`'s own
in-process test pattern):

| Metric | Target for v1 acceptance |
|---|---|
| % of inbound (`McpRegistryServer`) and outbound (`McpToolSource`) calls journaled with a policy verdict | 100% — this is a correctness bar, not a tunable target |
| Detection rate: a deliberately mutated tool description on refresh | caught and flagged every time — a benchmark case with a fixture MCP server that changes a tool's description between two `refresh()` calls is the acceptance test |
| False-positive rate: an unrelated tool's re-approval prompt fires when a different tool's definition changed | zero — per-tool hashing (ADR 0016's rejected "whole-list hash" alternative) is what this metric exists to protect |
| % of actions in a `naro serve`-driven run with a non-empty `principal` in their evidence record | 100% when the control plane authenticated the caller, 0% (not partial) when it didn't — no silent partial attribution |

## Dependencies

- `@naro/adapter-mcp`, `@naro/adapter-harness` (`HarnessKernel`) — ADR
  0015's mechanism.
- `@naro/tools` (`ToolRegistry`, `Tool.definitionHash`) — ADR 0016.
- `@naro/core` (`PolicyContext.principal`), `cli/src/serve.ts` — ADR 0017.
- `@naro/contract-tests` (`toolSourceContract` extension).
- `@naro/observability` (`buildEvidence`) and `@naro/client` for the
  evidence-tree surfacing.

## Risks and open questions

- **All three underlying ADRs are `proposed`, not `accepted`.** This PRD
  is only buildable once they're reviewed and accepted on their own
  terms — it is a packaging document, not a substitute for that review.
- **`McpRegistryServer`'s constructor signature changes** (ADR 0015) is a
  breaking change to `@naro/adapter-mcp`'s public API — needs a
  changeset and a major-version note, not a silent minor bump.
- **Per-tool re-approval UX needs design**, not just a console badge — an
  operator managing dozens of MCP-sourced tools across multiple servers
  needs a queue, not a wall of individual prompts. Flagged here,
  unscoped; likely belongs with whatever eventually owns approval UX
  broadly (the console's approval surface already exists for human-in-
  the-loop actions — this may compose with it rather than needing a new
  one).
- **Does a changed `definitionHash` on a low-risk, read-only tool deserve
  the same forced re-approval as a destructive one?** ADR 0016's decision
  forces re-approval regardless of the tool's prior classification,
  deliberately conservative for v1. Loosening this (e.g., auto-accept a
  changed description on a `read`-classified tool) is a plausible v2
  relaxation once real usage data shows the conservative default causes
  fatigue rather than catching real issues — not assumed here.

## Milestones

1. ADR 0015 implementation (`McpRegistryServer` + `HarnessKernel`) —
   smallest, most mechanical, no new data model.
2. ADR 0016 implementation (`definitionHash`, `ToolRegistry` change
   detection, `toolSourceContract` extension) — the core trust claim of
   this PRD; needs its own fixture-based test proving detection actually
   fires.
3. ADR 0017 implementation (`PolicyContext.principal`, `naro serve`
   wiring) — can proceed in parallel with 1–2, no shared code.
4. Evidence-tree/console surfacing of all three, once 1–3 are journaling
   the data to surface.
5. One real benchmark scenario (mutated-tool-definition fixture) proving
   the detection-rate metric above, not simulated.
