# Foundations

An AI system is more than a model call. It is a controlled loop that proposes actions, obtains authorization, executes against real environments, observes outcomes, and only then claims success.

This section establishes the vocabulary and invariants used throughout the guide.

## What an AI system actually contains

| Layer | Responsibility | Typical failure if missing |
|-------|----------------|----------------------------|
| Model / Reasoner | Propose next decision | Hallucinated plans, wrong tool choice |
| Policy / Authorization | Decide whether the proposal may run | Uncontrolled side effects, prompt injection success |
| Environment / Hands | Execute and return evidence | Silent failures, no audit of what really happened |
| Verification | Accept or reject the evidence | Demo success, production distrust |
| Journal | Immutable record of intent + evidence | Impossible to audit or resume |
| Human / Ownership | Define risk, approve, operate | No one accountable when it fails |

## The four killers of production AI

1. **Capability–Deployment Verification Gap** — works in the notebook, cannot be proven in production.
2. **Governance & Risk Controls** — autonomy granted before ownership, audit, or rollback exist.
3. **Dirty Data & Loose Contracts** — model sees garbage or emits unstructured output that downstream systems cannot trust.
4. **Unclear Value & Ownership** — no measurable outcome, no owner, cost grows unchecked.

Naro is designed so the first two are structural. The guide shows how to close the rest.

## Core invariants

- The runtime owns control. The model proposes; it does not authorize or execute.
- Intent (`Action`) and evidence (`Observation`) stay separate.
- Verification is a state. Completion is a claim until evidence is accepted.
- The journal is the source of truth.
- Domain safety lives below the model (jails, allowlists, contracts).

## Autonomy spectrum

| Level | Meaning | When to use | Naro realization |
|-------|---------|-------------|------------------|
| Advise | Recommend only | High risk or early exploration | Policy always requires approval or agent emits recommendations |
| Act with Approval | Prepare / initiate, human authorizes | Most production side effects | `require_approval` on destructive or irreversible tools |
| Act Autonomously | Act inside strict limits | Low-risk, well-bounded, monitored actions | Allow under capability allowlists, quotas, destination allowlists |

Autonomy is a policy configuration, not an architecture change.

Visual summaries: [Diagrams](../diagrams/).

Next: [Patterns](../01-patterns/) or jump to [Production Gaps](../03-production-gaps/).
