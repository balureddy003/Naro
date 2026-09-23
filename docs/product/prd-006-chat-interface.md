# PRD-006 — Chat Interface: Self-Deployable, Verifiable

Status: proposed
Owner: unassigned
Depends on: `@naro/client`, [ADR 0023](../adr/0023-console-renders-the-evidence-record-not-a-log.md), [PRD-002](prd-002-outcome-templates.md)
Depended on by: closes a gap PRD-002 already flagged (human-approval templates "still need a UI")

## Summary

A second reference UI on top of `@naro/client` — alongside the existing
ops console, not replacing it — built for the person actually using an
outcome template (PRD-002), not the operator auditing it. Chat-shaped:
you type a goal or reply, the agent streams its response, a tool call
shows up as an inline card the way Claude.ai's and ChatGPT's do. The
difference from both: every card can expand into the same
`EvidenceRecord` the ops console already renders — policy verdict, hash-
chain position, verifier result — because it's built on the same
`@naro/client` types, not a simplified restatement of them. Self-
deployable: a static bundle any `naro serve` instance already serves,
same as the console today.

## Problem

PRD-002 already named this gap and didn't solve it: "Human-approval
templates (email/review drafts) still need a UI — presumably the console
(PRD-003) or an even lighter surface (email digest with approve/edit/
reject links). Not designed here; flagged as a PRD-003 dependency." The
ops console (per [ADR 0023](../adr/0023-console-renders-the-evidence-record-not-a-log.md))
is deliberately an operator surface — a list of runs, a virtualized event
log, an evidence tree. It is not where a small business owner reads a
drafted customer email and clicks approve, and it was never meant to be.

Separately: nobody a small business owner would recognize ships a
self-hostable, verifiable chat interface. Three categories, three
different reasons none of them are this:

1. **Consumer AI products (ChatGPT, Claude.ai).** Polished chat UX, tool-
   call disclosure — but hosted-only, closed, and unverifiable: you see
   "used a tool," not proof it was authorized under a specific policy or
   that its output was checked. You trust the vendor's word.
2. **Self-hosted chat UIs for open models (Open WebUI, LibreChat, and
   similar).** Genuinely self-deployable — but there is no kernel
   underneath: no policy gate, no verifier, no hash-chained journal to
   show proof of. They're a chat front-end for a model, not for a
   governed agent.
3. **Agent orchestration framework UIs** (LangGraph Studio, Mastra's
   dashboard, and the rest of this field, per
   [docs/market-quadrant.md](../market-quadrant.md)). Developer/ops
   tools — graphs, traces, replay — none aimed at the person who just
   wants to approve a drafted email, per market-quadrant.md's own DX
   criterion scoring this field on developer experience, never end-user
   experience.

No entrant combines "chat-simple enough for a non-technical owner" with
"self-deployable" with "backed by actual proof, not a vendor's claim."
That combination is the point of this PRD, not a prettier UI for its
own sake.

## Goals

- A small business owner (PRD-002's named user) submits a goal, watches
  the agent work, and answers an approval — entirely in a chat-shaped
  interface, never seeing `Reasoner`, `PolicyEngine`, or a raw event log.
- Every tool-call/action card is expandable into real evidence — the
  same `ActionEvidence` shape ([`@naro/client`'s `types.ts`](../../client/src/types.ts))
  the ops console already renders, not a chat-specific reinterpretation
  of it. One shared rendering primitive, two hosts.
- Ships as a static bundle `naro serve` serves the same way it serves
  `/console` today (`GET /chat`, or similar) — no new backend contract.
  Confirmed buildable on existing wire types: `ApprovalRequest.question`/
  `.action`, `EvidenceRecord`, and `@naro/client`'s `watchRun`/
  `pollApprovals` headless primitives already carry everything this UI
  needs.
- Approval answering happens inline, in the flow of the conversation —
  not a separate queue page a business owner has to know to check.

## Non-goals

- Replacing the ops console. Different persona, different job — an
  operator auditing a fleet of runs still wants the console's list/tree
  view, not a chat transcript.
- A general-purpose LLM chat product (model picker, file uploads, chat
  history search, multi-modal input). Scoped to what a Naro-run agent's
  goal-submission → streaming → approval → evidence loop already is —
  not a ChatGPT clone with agent features bolted on.
- A hosted product. This is a self-deployable static bundle, same
  posture as the console; a hosted, multi-tenant chat surface is PRD-003's
  territory if it's ever built there.
- New backend/wire surface. Every field this PRD needs already exists in
  `@naro/client`'s types — if implementation reveals a real gap, that's a
  separate, explicitly-scoped follow-up, not silently absorbed here.

## Users and scenario

**Primary user:** PRD-002's named user — a small business owner or office
manager, not a developer.

**Scenario:** the business's invoice extractor template flags a
low-confidence document. Instead of an email digest or a console login,
the owner opens the chat interface (bookmarked, self-hosted, no vendor
account), sees the agent's message: "I couldn't confidently read the
total on this invoice — here's what I extracted, can you confirm?" —
with the extracted fields inline and an approve/correct control right
there. They tap expand once, out of curiosity, and see: policy allowed
this read, the extraction verifier flagged low confidence, nothing was
written yet. They answer. The conversation continues.

## Functional requirements

1. **Goal submission and streaming as chat turns.** A typed message
   becomes `client.submitGoal()`; the response streams via `watchRun` —
   `agent.completed`/`failed`/`cancelled` render as the final message,
   intermediate `action.*`/`observation.created` events render as inline
   cards within the same turn, not a separate log the user has to
   correlate themselves.
2. **Approval cards render `ApprovalRequest` directly** — `question` as
   the prompt, `action` (capability/target/input) as the inline detail,
   answering calls `client.answerApproval()` exactly as the console does
   today. No new approval data model.
3. **Evidence disclosure is opt-in, not default-visible.** A collapsed
   "verified" / "needs review" badge per action card (from
   `ActionEvidence.policy`/`.verification`), expandable to the full
   record on click — the chat stays chat-simple by default; the proof is
   one tap away, not the whole default surface (unlike the console, whose
   entire job is showing evidence by default).
4. **A visible stop control per in-flight run**, once
   [ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md) ships
   — "stop this" as a real button in the conversation, not a concept the
   user has to know exists elsewhere. This PRD depends on 0022 for that
   specific requirement; the rest of this PRD does not.
5. **No model/policy/reasoner configuration surface.** Whatever template
   (PRD-002) and policy the deployment configured is what runs; this UI
   is not where those get changed.
6. **Static bundle, same serving pattern as the console** — `naro
   serve`'s existing `GET /client/*.js` asset route serves this UI's
   compiled output too; no bundler dependency introduced into `cli`,
   consistent with the console's own "no build step" precedent.

## Success metrics

- Time from "business owner opens the app" to "first approval answered"
  — target: under a minute, no login/account creation beyond whatever
  `naro serve` principal auth the deployment already configured.
- % of approvals answered via this interface vs. falling back to the ops
  console or a raw API call — the actual adoption signal for whether the
  simpler surface is doing its job.
- % of users who ever expand an evidence card — a genuine curiosity/trust
  signal (not a target to maximize — a business owner who never needs to
  check is not a failure state).

## Dependencies

- `@naro/client` — no changes required; every type this PRD needs already
  ships (`ApprovalRequest`, `EvidenceRecord`, `ActionEvidence`,
  `watchRun`, `pollApprovals`).
- [ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md)
  (proposed) for the in-chat stop control specifically — everything else
  in this PRD is buildable without it.
- `naro serve`'s static-asset serving pattern (`cli/src/serve.ts`'s
  `GET /client/*.js` route) as the precedent for how this bundle gets
  served without a new backend endpoint shape.
- PRD-002's templates as what a business owner is actually approving —
  this UI is the surface, not the automation.

## Risks and open questions

- **Chat-simple and evidence-honest can pull against each other.** A UI
  optimized purely for approval speed risks becoming "click approve
  without reading" — the exact failure mode PRD-002's requirement 2
  ("no template auto-executes an irreversible action without human
  approval, full stop") exists to prevent becoming theater. The
  expandable-not-default evidence disclosure (requirement 3) is a
  deliberate middle ground, not a solved problem — needs real usage data
  before calling the balance right.
- **Multi-turn conversation vs. one-shot goal submission.** `AgentRunner`
  today runs one goal to completion (or a pause/approval boundary); a
  natural follow-up message ("actually, categorize it as X instead")
  needs a real answer for whether that's a new goal, a resumed run, or
  something else — not designed here, flagged as the first real design
  question implementation would need to answer.
- **Should this ship as part of `@naro/client`'s own package, or a
  separate `@naro/chat-ui`?** Leaning separate, mirroring how the console
  itself is `cli`-owned rather than `client`-owned — `@naro/client` stays
  the shared SDK layer, UIs built on it (console, this) stay separate
  consumers, consistent with the "logic here, rendering there" split
  `client/README.md` already documents.

## Milestones

1. Goal submission + streaming response, no approvals or evidence yet —
   prove the chat-shaped `watchRun` loop works before adding either.
2. Inline approval cards, wired to `client.answerApproval()` — the
   PRD-002 gap this PRD primarily exists to close.
3. Expandable evidence disclosure per action card, sharing rendering
   logic with the console rather than reimplementing it.
4. Stop control, gated on ADR 0022 shipping.
5. One real PRD-002 template (the invoice extractor or transaction
   categorizer) run end-to-end through this interface with a real
   business-shaped test scenario, not a synthetic one.
