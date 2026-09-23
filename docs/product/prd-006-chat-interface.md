# PRD-006 — One Interface, Three Roles: End User, Ops, Admin

Status: proposed
Owner: unassigned
Depends on: `@naro/client`, [ADR 0023](../adr/0023-console-renders-the-evidence-record-not-a-log.md), [ADR 0024](../adr/0024-admin-api-surface-for-registry-and-retention.md), [PRD-002](prd-002-outcome-templates.md)
Depended on by: closes a gap PRD-002 already flagged (human-approval templates "still need a UI")

**Revision note:** the original version of this PRD scoped a chat
interface for end users only, and its Non-goals explicitly excluded
replacing the ops console ("different persona, different job"). That
exclusion is revised here, not silently dropped: end user, ops, and
admin turn out to share one design system and one data source
(`@naro/client`'s wire types, `buildEvidence()`), and building three
separate products for three views of the same evidence was more
duplication than the difference in persona actually justified. This
version is one app shell with a role switch, not three apps. The
existing standalone ops console (`GET /console`, ADR 0023) is unaffected
and remains the CLI-adjacent, zero-JS-framework reference; this PRD's
ops and admin views are additive, a richer surface for a deployment that
wants one.

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

- A general-purpose LLM chat product (model picker, file uploads, chat
  history search, multi-modal input). The end-user view is scoped to
  what a Naro-run agent's goal-submission → streaming → approval →
  evidence loop already is — not a ChatGPT clone with agent features
  bolted on.
- A hosted product. This is a self-deployable static bundle, same
  posture as the console; a hosted, multi-tenant surface is PRD-003's
  territory if it's ever built there.
- Live CRUD over principals/roles. ADR 0012's principals are a token-file
  map the deployment configures, not a database this UI writes to — the
  admin view can *show* configured principals (read-only) but does not
  manage them; changing who has what role remains a deployment-config
  change, not an HTTP call.
- New backend/wire surface beyond what ADR 0024 already specifies. Every
  field the end-user and ops views need already exists in `@naro/client`'s
  types; the admin view's three write actions (collision resolve,
  definition acknowledge, prune) are exactly ADR 0024's three endpoints,
  no more. A capability that needs a fourth endpoint is out of scope
  until it has its own ADR.

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

**Ops user:** a bookkeeper or contracted admin assistant who supports
more than one small-business client through the same deployment — not a
developer, but comfortable auditing rather than just approving.
**Scenario:** they switch to the Ops view and see every run across every
tenant this principal can see (ADR 0013), each tagged by business —
Riverside Supply, Cedar Bakery — with a persistent chain-status banner
above the transcript confirming what they're looking at is the same
record `naro verify` would print, not a paraphrase. They can still
answer a pending approval from here; they cannot submit a new goal —
that's the end-user view's job, not theirs.

**Admin user:** whoever this deployment trusts with fleet-wide and
registry-level authority — often the same person as the technical
contact who set up `naro serve` in the first place. **Scenario:** an MCP
server the business connected starts advertising a tool description that
changed since it was last reviewed. The admin view surfaces it under
"Definition changes" with the old and new description side by side, and
a plain choice: acknowledge it, or leave the tool forced to
destructive-requires-approval until someone verifies the source. No
scrollback through a log to find this — it's a queue with a count badge,
the same pattern as the end-user's approval queue, because it's the same
underlying idea (a human decision a machine correctly declined to make
alone).

## Interface design

*Reference mockup:* [claude.ai/artifact/4FrvR54yYwkoo8vQyjVEnt](https://claude.ai/artifact/4FrvR54yYwkoo8vQyjVEnt)
— a working, interactive HTML prototype of the full app shell, not one
screen or one role. A segmented control at the top of the sidebar
switches between the three views this PRD now covers:

- **End user** — the conversation-history sidebar plus five states
  covering the distinct capabilities this PRD and PRD-002 actually
  claim: a numeric-correction approval (invoice total), a text-draft
  approval (customer email reply, showing the draft was influenced by
  `trust: 'external'` content but never acted on it directly), a
  fully-automated run with no approval needed (transaction categorizer,
  verifier passed on all 14), a run *blocked by policy* (a destructive
  action refused before it ran), and a live run with the stop control
  active.
- **Ops** — the same evidence, widened: every run across every tenant
  this principal can see, each entry tagged by tenant, with a
  chain-status banner pinned above the transcript on every run
  ("Chain OK · sealed (ed25519) · seq 340" or, on the denied run,
  "sealed · action denied, chain still OK" — the denial doesn't break
  the proof, it's recorded *by* it). Composer is hidden; this role reads
  and answers approvals, it doesn't submit goals.
- **Admin** — a fixed nav (not a conversation list) covering exactly
  [ADR 0024](../adr/0024-admin-api-surface-for-registry-and-retention.md)'s
  three write endpoints plus the fleet-halt endpoint ADR 0022 already
  shipped: a collision case (two sources claiming the tool name
  `search`, shown side by side with their definition hashes, one button
  per outcome), a definition-change case (an MCP tool's description
  grew a capability nobody approved, shown as old-vs-new text), a
  retention form (run, cutoff sequence, policy citation), and a
  fleet-wide halt requiring a reason before it's enabled.

Every capability shown maps to a named, real endpoint or an explicitly
proposed one (ADR 0024) — nothing in the admin view implies HTTP surface
that isn't specified somewhere. Built against the real `@naro/client`
wire shapes so the interaction model, not just the look, is the actual
spec. "Intuitive" is not a design-taste adjective here — it is the bar
in Success metrics below: a first-time user completes the approval flow
with zero instructions, in under a minute. Everything in this section
exists to make that bar checkable, not just aspirational.

**A conversation-history sidebar is in scope; search is not.** A plain,
reverse-chronological list of past runs — template name, one-line
status, relative time — is exposed already by `GET /runs`/`client.listRuns()`;
showing it in a sidebar is not the "chat history search" this PRD's
Non-goals excludes (a search box, filters, full-text query). The
distinction matters: a list an owner can scan is core to any multi-run
tool; a search feature is scope this PRD deliberately isn't taking on.

**Layout.** Sidebar (fixed width, collapses to an off-canvas drawer under
~780px, per the responsive requirement every artifact and this UI both
follow) plus a single-column transcript, centered, ~720px max width,
16px+ side gutters at every width down to phone. A sticky, minimal
header names the *template* ("Riverside Supply — Invoice Assistant"),
never the kernel — no `Reasoner`, no `PolicyEngine`, matching
requirement 5. A sticky composer stays at the bottom; nothing else is
chrome.

**A policy denial is a first-class state, not an edge case to hide.**
The mockup's "Archive cleanup — blocked by policy" conversation exists
deliberately: a UI that only ever shows successful, approved actions
proves nothing about enforcement — it could just as easily be a UI with
no gate behind it at all. Showing the system *refuse* something, with
the reason visible on request, is the stronger proof, and requirement 3
already implies it: `ActionEvidence.policy === 'denied'` renders with
the same chip-and-expand pattern as everything else, in the danger
color, never suppressed from the transcript.

**Turn-taking, not bubbles-everywhere.** User messages are compact,
right-aligned, visually set apart (a filled pill). Assistant responses
are full-width, unbubbled text — Claude.ai's actual pattern, not
ChatGPT's boxed-both-sides one — because a template's response (extracted
fields, a multi-line explanation) reads better with room to breathe than
squeezed into a bubble.

**Evidence disclosure is a chip, not a wall of JSON.** Each action
renders as a small inline pill: a status dot (✓ verified / a distinct
mark for needs-review) plus the action's plain-language name plus a
chevron. Collapsed by default, exactly as requirement 3 already
specifies — the chip expands *in place* (an accordion under the chip,
not a modal or a side drawer, so the conversation's scroll position
never jumps) into the same `ActionEvidence` fields the console shows:
`policy`, `verification`, and a truncated hash-chain link. Copy for that
expanded state should say, plainly, that it's the same record `naro
verify` would print — the point of ADR 0023 stated as UI copy, not left
implicit.

**Approval cards are visually distinct from messages.** A bordered card,
not a chat bubble — this is a decision point, not conversation. One plain
question, the specific field in question, an editable input pre-filled
with the agent's best guess (not a blank field the user has to fill from
scratch), and never more than two primary actions: one filled button for
the affirmative path, one outline/ghost button for the negative one.
Resolving a card replaces its contents in place with a one-line
confirmation ("Confirmed $2,847.00 — recorded just now") rather than
dismissing it — the record of *what was approved* stays visible in the
transcript's scroll history, not just its outcome.

**A single semantic color system, reused everywhere.** One accent for
verified/success, one warn tone for needs-review, one danger tone for
rejected/error — the same three colors on evidence-chip status dots,
field-level flags (a specific extracted value under a confidence
threshold), and approval-card borders. Never a fourth ad hoc color for a
new state; a genuinely new state gets mapped onto one of the three or
this system has failed its job.

**Copy has no jargon, anywhere** — not "action.completed," not "policy:
permitted," not a capability string. "Read invoice_2847.pdf." "Recorded
in ledger." "Confirmed $2,847.00 — recorded just now." The expanded
evidence view is the one place technical fields (`policy`, `verifier`,
a chain hash) are allowed, because a user who opened it has already
signaled they want that detail.

**Motion is a whisper, not a feature.** A three-dot "waiting" indicator
while a run is in flight is the only animation this interface needs;
`prefers-reduced-motion` disables even that. No page-load choreography,
no flourish — the trust story this PRD exists to tell is undermined, not
helped, by an interface that performs busyness.

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
4. **A visible stop control per in-flight run**, calling the now-shipped
   `POST /runs/:id/cancel` ([ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md),
   accepted and implemented) — "stop this" as a real button in the
   conversation, not a concept the user has to know exists elsewhere.
5. **No model/policy/reasoner configuration surface.** Whatever template
   (PRD-002) and policy the deployment configured is what runs; this UI
   is not where those get changed.
6. **Static bundle, same serving pattern as the console** — `naro
   serve`'s existing `GET /client/*.js` asset route serves this UI's
   compiled output too; no bundler dependency introduced into `cli`,
   consistent with the console's own "no build step" precedent.
7. **The role switch reflects the caller's actual roles, not a UI
   preference.** A principal without `admin` in `ADR 0012`'s role set
   never sees the Admin tab rendered at all — not disabled, not visible-
   but-403, absent — the same fail-toward-least-privilege default ADR
   0022 already chose for the `admin` role itself. Ops and end-user tabs
   render for any principal holding `viewer`/`operator`/`approver`
   respectively; a principal with only `viewer` sees Ops but not the
   end-user composer (no `operator` grant to submit goals with).
8. **Ops view is `GET /runs` (unscoped by the caller's own runs) plus the
   chain banner from `GET /runs/:id/evidence`.** No new endpoint — this
   is the same data `GET /runs` already returns across tenants per ADR
   0013's visibility rules, rendered as a list instead of a table, with
   `client.answerApproval()` still live (matching the existing console's
   "read-only except answering approvals" posture, [`cli/src/console.ts`](../../cli/src/console.ts)).
9. **Admin view's three write actions call exactly ADR 0024's three
   endpoints** — `POST /admin/tool-collisions/resolve`, `POST
   /admin/tool-definitions/acknowledge`, `POST /admin/runs/:id/prune` —
   plus the already-shipped `POST /runs/cancel-all` for fleet halt. Every
   action requires the justification field its backend ADR already
   requires (a `policy` citation for prune, an implicit "which source
   wins" for collision resolve); the UI does not accept a write with that
   field empty.

## Success metrics

- Time from "business owner opens the app" to "first approval answered"
  — target: under a minute, no login/account creation beyond whatever
  `naro serve` principal auth the deployment already configured, and with
  zero instructions given beforehand — the actual operationalization of
  "intuitive" this PRD is built against (see Interface design).
- % of approvals answered via this interface vs. falling back to the ops
  console or a raw API call — the actual adoption signal for whether the
  simpler surface is doing its job.
- % of users who ever expand an evidence card — a genuine curiosity/trust
  signal (not a target to maximize — a business owner who never needs to
  check is not a failure state).
- Time from a pending tool-collision or definition-change detection to
  admin resolution — a queue that never empties is worse than no queue;
  this is the operational health signal for the admin view specifically.
- Zero admin actions taken with an empty justification field — a
  correctness bar for requirement 9, not an aspiration.

## Dependencies

- `@naro/client` — no changes required for the end-user and ops views;
  every type they need already ships (`ApprovalRequest`, `EvidenceRecord`,
  `ActionEvidence`, `watchRun`, `pollApprovals`, `listRuns`).
- [ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md)
  (accepted, implemented) for the in-chat stop control and the admin
  fleet-halt control — both call `POST /runs/:id/cancel`/`POST
  /runs/cancel-all`, real and callable today.
- [ADR 0024](../adr/0024-admin-api-surface-for-registry-and-retention.md)
  (proposed) for the admin view's three write actions — this PRD's admin
  view cannot ship ahead of that ADR being accepted and implemented; the
  end-user and ops views have no such dependency and can ship first.
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
4. Stop control, calling the already-shipped `POST /runs/:id/cancel`.
5. One real PRD-002 template (the invoice extractor or transaction
   categorizer) run end-to-end through this interface with a real
   business-shaped test scenario, not a synthetic one.
6. Role switch + Ops view — read-only run list across tenants plus the
   chain-status banner, reusing `GET /runs` and `GET /runs/:id/evidence`.
   No new backend work; this milestone is UI-only and can start as soon
   as milestone 3 lands.
7. ADR 0024 accepted and its three endpoints implemented — a hard
   prerequisite for milestone 8, tracked separately from this PRD's own
   work since it's kernel/control-plane surface, not UI.
8. Admin view — fleet halt (reuses milestone 4's mechanism), then
   collision resolution, definition acknowledgment, and retention
   pruning against ADR 0024's real endpoints once milestone 7 ships.
