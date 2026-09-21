# Architecture Decision Records

Each record captures one decision that shapes Naro, the alternatives that were
rejected, and the consequences the codebase now lives with. Records are
numbered in the order they were written and are never edited after acceptance;
a superseding record links back.

Read these when you want to know *why* the code is shaped the way it is. Read
[architecture.md](../architecture.md) when you want to know *what* it does.

| # | Decision | Status |
|---|---|---|
| [0001](0001-verification-is-a-runtime-state.md) | Verification is a state in the agent state machine | accepted |
| [0002](0002-action-and-observation-are-separate.md) | Intent (`Action`) and evidence (`Observation`) are separate records | accepted |
| [0003](0003-policy-engine-is-required.md) | `AgentRunner.policy` is required; the model cannot self-authorize | accepted |
| [0004](0004-checkpoints-at-reasoning-boundaries.md) | Checkpoints are taken only at reasoning boundaries | accepted |
| [0005](0005-hash-chain-in-the-event-bus.md) | The hash chain is computed in the event bus, with optional fields | accepted |
| [0006](0006-core-depends-only-on-node.md) | `@naro/core` imports nothing beyond `node:` builtins | accepted |
| [0007](0007-journal-is-the-source-of-truth-for-session-state.md) | The journal is the source of truth for session state (`wake`, compaction-as-event) | accepted |
| [0008](0008-environments-are-reachable-over-http.md) | Environments are reachable over HTTP | accepted |
| [0009](0009-governance-beneath-foreign-harnesses.md) | Governance adapters run beneath foreign harnesses via their tool-call hooks | accepted |
| [0010](0010-provenance-is-a-policy-input.md) | `Observation.trust` and `ctx.provenance` make evidence origin a policy input | accepted |
| [0011](0011-policy-verdicts-carry-reasons.md) | `PolicyVerdict` adds a reason to every gate outcome | accepted |

## Template

```markdown
# NNNN — Title

Status: proposed | accepted | superseded by NNNN
Date: YYYY-MM-DD

## Context
What forces were in play. Link to code and tests.

## Decision
One paragraph. Present tense.

## Alternatives considered
Each with the reason it lost.

## Consequences
What became easier, what became harder, what must now be maintained.
```
