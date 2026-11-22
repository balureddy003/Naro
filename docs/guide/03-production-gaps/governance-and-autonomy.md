# Governance, Risk Controls, and Autonomy Levels

## The gap

Organizations frequently grant agents access and authority before establishing ownership, audit trails, rollback, or human-in-the-loop gates for irreversible actions. Autonomy is treated as a binary (on/off) rather than a governed spectrum.

Common failure modes:

- Agents can self-authorize or bypass controls.
- No durable record of who approved what.
- No clear mapping from business risk to technical controls.
- Prompt injection or untrusted content can trigger side effects.

## What “closed” looks like

Three practical autonomy levels, implemented as policy rather than architecture changes:

1. **Advise** — Agent recommends; human decides and executes.
2. **Act with Approval** — Agent prepares or initiates; explicit human authorization required before execution.
3. **Act Autonomously** — Agent acts inside strict, predefined limits with continuous monitoring and escalation.

Plus: required authorization before every action, provenance-aware controls, and an immutable audit trail.

## How Naro addresses it

- **Policy engine is required.** Every action passes `WAITING_FOR_PERMISSION`. The model cannot self-authorize.
- **Autonomy levels are policy configurations:**
  - Advise → policy always requires approval or the agent only emits recommendations.
  - Act with Approval → default for side-effecting or destructive tools (`require_approval`).
  - Act Autonomously → allow under explicit limits (capability allowlists, quotas, destination allowlists, grants).
- **HumanBridge** for approvals; approvals can be persisted (SQLite/Postgres) and survive restarts.
- **Provenance as a policy input.** `Observation.trust` and `ctx.provenance` allow policies such as `denyExternalTriggered` so untrusted content cannot drive side effects.
- **Unknown tools denied by default.** Baseline tool policy and grants.
- **Journal records every policy verdict.** Approver identity can be journaled.

See also: [Security and policy](../../learn/11-security-and-policy.md), policy package, and architecture trust-boundary section.

## What remains application- or organization-owned

- Defining the actual risk tiers and which tools/actions belong to which autonomy level.
- Identity, RBAC, and approval workflow integration with enterprise systems.
- Operational ownership (who reviews denials, who owns the policy rules).
- Key and secret management.

## Checklist

- [ ] Policy engine is present and cannot be bypassed.
- [ ] Every side-effecting tool is classified (deny / require approval / allow-with-limits).
- [ ] Provenance / external-content rules are enabled where relevant.
- [ ] Approval path is durable and attributable.
- [ ] Autonomy level for each agent or tool set is documented and reviewed.
- [ ] Journal of policy decisions is retained and reviewable.
