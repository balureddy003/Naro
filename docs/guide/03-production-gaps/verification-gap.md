# Capability–Deployment Verification Gap

## The gap

An agent can succeed in a controlled demo yet be impossible to verify, trust, or audit once it runs against live systems and proprietary data. Teams cannot answer:

- What actions were taken?
- Under what authorization?
- What evidence shows the outcome was correct?
- Can we prove the record was not altered?

Without this, production deployment is blocked or later reversed.

## What “closed” looks like

- Every completion is a claim until a verifier accepts evidence.
- Intent and evidence are separate records.
- An immutable, ordered, verifiable journal exists for every run.
- Operators can reconstruct and cryptographically check a run after the fact.
- Verification failure forces replanning rather than silent success.

## How Naro addresses it

- **Verification is a runtime state.** A `complete` decision enters `VERIFYING`. Rejection moves the runner to `REPLANNING` and records an observation the reasoner can see.
- **Per-action verification** follows the same path.
- **Action vs Observation.** Failures, denials, and refused approvals become observations with `success: false`.
- **Hash-chained journal.** Every event carries `prev` and `hash`. `naro verify` recomputes the chain. Optional Ed25519 sealing of the journal head.
- **Evidence record.** `buildEvidence` joins policy verdict → action → observation → verifier verdict. The same record is used by `naro verify` and the console.
- **Journal as source of truth.** `AgentRunner.wake(runId)` rebuilds session state from the journal alone.

See also: [Evidence-gated completion](../../concepts/evidence-gated-completion.md), [Architecture](../../architecture.md) (state machine and journal sections).

## What remains application- or organization-owned

- Choice and calibration of verifiers (schema, predicate, command, human, LLM-judge).
- Retention, access control, and key custody for sealed journals (KMS/HSM recommended).
- Mapping evidence records into existing compliance or ticketing systems.
- Defining what “success” means for each goal (the verifier implements the definition).

## Checklist

- [ ] A verifier is configured for every production agent (completion is not trusted by default).
- [ ] Destructive or high-impact actions have explicit verification or human review.
- [ ] Journal export and `naro verify` (or equivalent) are part of the operational runbook.
- [ ] Evidence records are retained according to policy.
- [ ] Key material for sealing (if used) is held outside the application process.
