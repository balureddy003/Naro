# Glossary

## Action

A request to inspect or change the world. It carries an actor, capability,
target URI, input, requested permissions, lifecycle state, and idempotency key.
An action is intent, not proof that anything happened.

## ActionExecutor

The port that turns an authorized `Action` into an `Observation`. Tools,
environments, workflow steps, sandboxes, and domain integrations all implement
or compose this contract.

## AgentBus

The request/reply contract used for agent delegation. Implementations include
in-process, HTTP, SQLite-durable, and A2A transports.

## AgentRunner

The runtime owner of one agent run. It controls state transitions, invokes the
reasoner, applies policy, executes actions, records observations, verifies
outcomes, checkpoints state, and emits events.

## AgentSpec

The identity and goal supplied to a runner. Runtime dependencies are composed
separately.

## Capability

A stable name for something an action exercises, such as `tool.invoke`,
`fs.read`, or `robot.act`. Policy evaluates capabilities and targets.

## Checkpoint

A reasoning-boundary snapshot containing iteration, tasks, actions,
observations, context, optional reasoner state, run identity, and event journal
position. A checkpoint supports at-least-once recovery; it is not a rollback of
external state.

## Context

Information selected for the current run or decision. `ContextItem` preserves
source and optional relevance score. Context is bounded and may contain
untrusted data.

## Decision

The closed protocol returned by a reasoner:

```text
plan | act | act-batch | need-context | wait-for-human | complete | fail
```

A decision proposes control flow. The runtime remains authoritative.

## Environment

A representation of the world an agent can observe or change. Filesystems,
browsers, databases, runbooks, workflows, and robots are domain environments.

## Event

An immutable typed fact emitted during a run. Every event carries agent, goal,
run ID, monotonic sequence, timestamp, type, a structured-clone payload, and
its hash-chain fields (`prev`, `hash`).

## Evidence record

The per-run join produced by `buildEvidence()`: chain verdict plus, for each
action, the policy outcome, the observation, and the verifier verdict.
`naro verify <run.jsonl>` prints it.

## Goal

The desired outcome of a run, including human-readable success criteria. A goal
does not grant permissions.

## Grant

A permission explicitly assigned to an agent composition. Policy compares
requested or tool-required permissions with grants.

## Hash chain

The tamper-evident linking of a run's events: each event's `hash` covers its
content and `prev` (its predecessor's hash), so editing, deleting, or
reordering any event breaks every link after it. Tamper-evident, not
tamper-proof — sealing (below) moves the residual trust to key custody —
see [evidence-gated completion](concepts/evidence-gated-completion.md).

## HumanBridge

The runtime port for questions and action approvals. If approval is required
and no bridge is configured, the action is denied.

## Idempotency key

A stable identifier for one logical action. It lets an external system detect a
repeated request after retry or recovery. Naro generates a deterministic
default; the target must enforce it.

## Lease

A time-limited claim that one runner holds for an agent. A lease prevents a
second live runner from starting while the claim remains valid.

## Memory

Information retained for later recall. Naro separates working, session,
episodic, semantic, procedural, and long-term tiers because they have different
lifetimes and trust requirements.

## Model

A provider-neutral interface for chat and optional capabilities such as tool
calling, streaming, vision, embeddings, reranking, and structured output.
Capabilities are declared and checked rather than assumed.

## Observation

Evidence produced by execution, verification, a human, or the runtime. It
records source, success, output or error, and an optional originating action.

## PolicyEngine

The required authorization port called before every action. It returns
`allow`, `deny`, `require_approval`, `limit`, or `audit` — bare or wrapped
in a `PolicyVerdict` whose `reason` lands on the denial event and
observation as evidence.

## Profile

A reusable domain package that combines environments, tools, drivers, and
safety constraints without adding domain concepts to the kernel.

## Provenance

Information about where context, memory, or evidence came from. Provenance
supports citation, filtering, trust decisions, and incident analysis. In the
policy gate, `ctx.provenance` summarizes the trust of the evidence the
reasoner saw before requesting an action.

## Reasoner

A strategy that reads `ReasoningContext` and returns one `Decision`.
`StatefulReasoner` additionally captures and restores internal checkpoint state.

## Run ID

The identity of one logical execution. It remains stable across checkpoint
resume and appears on every event.

## Seal

A terminal `journal.sealed` event carrying an Ed25519 signature over the
chain head (`EventBus.seal`, `AgentDeps.sealKey`). Anyone with the public
key can prove the journal ends where the signer left it — `naro verify
--pubkey` pins the expected key. Sealed journals cannot be `wake()`n; the
seal is a signature over finality.

## Session

A run's durable state — the journal plus what `recoverSession()` rebuilds
from it: tasks, actions, observations, context, iteration, chain head.
`AgentRunner.wake()` resumes from the session alone; checkpoints are a
fast-hydrate optimization over the same facts.

## Side effects

Tool metadata describing external impact: `none`, `read`, `write`, or
`destructive`. Policy can use this classification before execution.

## Tool

A named capability with input/output schemas, permissions, side-effect metadata,
and an execution function.

## Trust level

`Observation.trust` — who authored the evidence: `system` (runtime or human),
`tool` (a tool's output), or `external` (content written outside the system:
web pages, emails, untrusted repos). Drives transcript delimiting and is
available to policy as `ctx.provenance`.

## Verification

An evidence check returning `ok`, optional evidence, and a failure reason. A
model completion is a claim until verification establishes success. The same
verifier is called per action (with `observation`) and on the completion claim
(with `result`); `atCompletion` / `perAction` scope a check to one phase.
