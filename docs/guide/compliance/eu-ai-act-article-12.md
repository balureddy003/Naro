# EU AI Act Article 12 — Record-Keeping Mapping

Article 12 requires high-risk AI systems to automatically record events (logs) over the lifetime of the system to enable traceability and post-market monitoring.

This page maps those requirements to mechanisms already present in Naro. It is a technical mapping, not legal advice.

## Mapping

| Article 12 concern | Naro mechanism | Gap |
|--------------------|----------------|-----|
| Automatic recording of events | Hash-chained event journal (every policy verdict, action, observation, verifier result) | None for the technical record |
| Traceability of decisions | Evidence record joins policy → action → observation → verifier | None |
| Identification of the system and version | Agent spec + journal metadata (extend with deployment version if needed) | Minor — add explicit version field if required |
| Period of retention | Journal export + storage | Organizational — retention policy and enforcement not yet built-in |
| Integrity / tamper evidence | Hash chain + optional Ed25519 sealing | Key custody is deployment-owned (KMS/HSM recommended) |
| Access for authorities / auditors | `naro verify` + evidence export | Access-control and export workflow are operational |

## What Naro already gives a regulated buyer

- Immutable, ordered, verifiable record of intent and evidence
- Clear separation of authorization and outcome
- Ability to reconstruct and cryptographically check any run

## What remains

- Formal retention policy and automated enforcement
- Key-management integration (KMS/HSM)
- Operator-facing evidence console and export workflows tailored to audit requests
- Organizational processes around the technical artifacts

See the full compliance note in the main docs if present, and the [high-stakes architecture](../04-reference-architectures/high-stakes-regulated.md).
