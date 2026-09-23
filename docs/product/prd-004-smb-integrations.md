# PRD-004 — SMB Integrations

Status: proposed
Owner: unassigned
Depends on: [PRD-002](prd-002-outcome-templates.md), `@naro/tools` (`Tool`, `SecretProvider`); milestone 4 specifically depends on [PRD-006](prd-006-chat-interface.md) (the approval UI, not PRD-003 — see that milestone)

## Summary

Tool connectors for the systems a small business actually runs —
QuickBooks/Xero, Gmail/Outlook, Shopify, Square, plain CSV — following
the same pattern `@naro/adapter-slack` already established this session:
declarative `Tool`s with honest `permissions`/`sideEffects`, governed by
policy exactly like any other action.

## Problem

PRD-002's templates need data to operate on: a bank feed for the
transaction categorizer, a document source for the invoice extractor, an
inbox for the email drafter. Without real connectors, a template is a
demo, not a product. Enterprise connector catalogs (Salesforce,
ServiceNow, NetSuite) are the wrong list — a small business does not run
those systems.

## Goals

- Ship connectors matching PRD-002's first two templates exactly:
  a bank/card feed source (for the transaction categorizer) and a
  document ingestion source (for the invoice/receipt extractor).
- Every connector follows `@naro/adapter-slack`'s established shape:
  one `Tool` per operation, explicit `permissions` and `sideEffects`,
  `trust: 'external'` on anything returning content the business didn't
  author (an email body, a review, a bank transaction description) —
  the same provenance boundary [ADR 0010](../adr/0010-provenance-is-a-policy-input.md)
  already established.
- A business can connect an account through an OAuth flow or an API key,
  not a config file they hand-edit.

## Non-goals

- A general-purpose integration platform (Zapier/Make competitor).
  Connectors exist to feed PRD-002's templates, not as a standalone
  product.
- Enterprise systems (Salesforce, SAP, ServiceNow). Explicitly the wrong
  list for this buyer — see Problem.
- Write-heavy, irreversible integrations in v1 (auto-posting to
  accounting software, auto-sending emails). PRD-002 requirement 2
  (human approval on anything customer-facing/irreversible) applies here
  too — a connector can read freely and write only behind approval.

## Candidate connectors (v1 scope: pick 2, matching PRD-002's first two templates)

| Connector | Serves template | Read operations | Write operations (approval-gated) |
|---|---|---|---|
| Bank/card feed (Plaid or direct bank API) | Transaction categorizer | list transactions, get transaction detail | apply category (if the business wants write-back, not just a report) |
| Document source (email attachment inbox, or direct upload) | Invoice/receipt extractor | fetch document, list inbox | none required for v1 — extraction output can be a report |
| Gmail/Outlook | Email draft-reply, appointment scheduling | read thread, list inbox | send (always approval-gated, never automatic) |
| Shopify/Square | Review response drafter (order context), future templates | read orders, read reviews if API exposes them | none in v1 |
| CSV import | Any template, as a fallback data source requiring no OAuth integration at all | parse upload | n/a |

**Recommended first two *real* connectors:** bank/card feed and document
source — no send-capable write path in either, which keeps them free of
the approval-UI dependency PRD-002 flags for the customer-facing
templates. This is not the same claim as "ships first" — CSV import
ships ahead of both (see Risks and Milestones below); "first two" scopes
which OAuth-integrated connectors to build, once CSV import has already
de-risked the templates against connector-partnership delays.

## Functional requirements

1. **Every connector is `Tool[]` via a factory function**
   (`bankFeedTools(opts)`, matching `slackTools(opts)`'s shape exactly)
   — no new integration abstraction invented.
2. **Credentials are deployment configuration, resolved before
   construction** — the same posture `@naro/adapter-vault` and
   `@naro/adapter-slack` already document: an OAuth token or API key is
   resolved via a `SecretProvider` chain and passed to the connector
   factory, never embedded in action input.
3. **Read operations carry `trust: 'external'`** wherever the content
   originates outside the business's own authored text (a transaction
   description, an email body, a review) — required for the provenance
   defense ADR 0010 established, not optional per-connector.
4. **Write operations default to `sideEffects: 'write'` or
   `'destructive'` and are deniable/approval-gated by policy** — no
   connector ships a write path that bypasses `PolicyEngine`.
5. **Rate limits and pagination are the connector's problem, not the
   template's.** A `Tool`'s `execute()` handles provider-side pagination
   internally; templates request "recent transactions," not raw API
   pages.

## Success metrics

- Time to connect an account (OAuth flow completion) — target under five
  minutes, feeding PRD-002/PRD-003's "under an hour to first outcome"
  requirement.
- Connector uptime / API error rate — a flaky bank-feed connector breaks
  every template that depends on it, so this is tracked per connector,
  not just per template.
- % of businesses who connect via OAuth vs. fall back to CSV import — a
  signal of whether the OAuth integrations are actually working smoothly
  enough to be worth their maintenance cost.

## Dependencies

- `@naro/tools` (`Tool`, `SecretProvider`) — no new package pattern.
- `@naro/adapter-vault` or equivalent for storing tenant-supplied OAuth
  tokens/API keys (PRD-003's secrets requirement, shared with this PRD).
- PRD-002's templates, which define what data shape each connector must
  produce.

## Risks and open questions

- **OAuth app approval and provider partnership overhead** (Plaid,
  QuickBooks, Google, Shopify all have their own app-review processes)
  is real calendar time this PRD's estimate has not accounted for — flag
  before committing to a launch date tied to a specific connector.
- **Bank/financial data connectors carry real compliance weight**
  (data handling, potentially PCI-adjacent depending on scope) that this
  PRD does not resolve — needs a compliance review before the bank-feed
  connector, specifically, ships to real customer data.
- **CSV import is the unglamorous fallback that might matter most.** It
  requires no OAuth partnership, no approval process, and no compliance
  review, and it unblocks every template immediately. Resolved, not just
  flagged: the Milestones section below ships it first (milestone 1),
  ahead of the "recommended first two" real connectors — see the note
  on that line in Candidate connectors.

## Milestones

1. CSV import (both templates' data shapes, no external partnership
   required) — unblocks PRD-002's real-data benchmarking immediately.
2. Document source connector (email attachment or direct upload) for
   the invoice/receipt extractor.
3. Bank/card feed connector, gated on the compliance review above.
4. Gmail/Outlook, once an approval UI exists ([PRD-006](prd-006-chat-interface.md)
   — its approval cards, `client.answerApproval()`, functional
   requirement 2 — not PRD-003, which is the hosted control plane, a
   different PRD) to gate the send path.
