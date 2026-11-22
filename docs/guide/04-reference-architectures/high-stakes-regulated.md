# High-Stakes / Regulated Agent

An agent that operates in a domain where actions or outputs can have legal, financial, safety, or compliance consequences.

## Capabilities

- Domain-specific tools and environment (coding, data, research, devops, etc.)
- Strict capability allowlists
- Human approval for every irreversible or high-impact action

## Controls

- Policy engine cannot be bypassed
- Provenance-aware denials for external content
- Per-action and completion verification (schema + predicate + human where required)
- Autonomy level explicitly set to “Act with Approval” or tighter
- Cost and token budgets
- Journal sealing (Ed25519) with key custody outside the process

## Evidence

- Hash-chained, optionally sealed journal
- Evidence record for every action and for completion
- Approver identity journaled
- Retention policy defined and enforced
- `naro verify` (or equivalent) part of the operational and audit runbook

## Production boundary

Suitable as the technical foundation for regulated use cases. Organizational controls (ownership, retention schedule, access control, key management, incident response) remain mandatory and are outside the kernel.

See also: [EU AI Act Article 12 mapping](../compliance/eu-ai-act-article-12.md), [Verification Gap](../03-production-gaps/verification-gap.md), [Governance and Autonomy](../03-production-gaps/governance-and-autonomy.md).
