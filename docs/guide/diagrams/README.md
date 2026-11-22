# Diagrams

Visual summaries of the core invariants. These diagrams are intentionally simple so they remain accurate as the implementation evolves.

## Core agent loop

```mermaid
stateDiagram-v2
    [*] --> Reason
    Reason --> Authorize: decision
    Authorize --> Act: allow
    Authorize --> Reason: deny / require_approval
    Act --> Observe
    Observe --> Verify
    Verify --> Complete: accept
    Verify --> Replan: reject
    Replan --> Reason
    Complete --> [*]
```

## Evidence flow

```mermaid
flowchart LR
    Policy[Policy verdict] --> Evidence[Evidence record]
    Action[Action intent] --> Evidence
    Observation[Observation] --> Evidence
    Verifier[Verifier verdict] --> Evidence
    Evidence --> Journal[Hash-chained journal]
    Journal --> VerifyCmd["naro verify"]
```

## Autonomy decision tree

```mermaid
flowchart TD
    Start[New tool or action] --> Risk{Irreversible or regulated?}
    Risk -->|Yes| Approval[Require approval]
    Risk -->|No| Bounded{Strict limits possible?}
    Bounded -->|Yes| Auto[Allow under limits]
    Bounded -->|No| Approval
    Approval --> Journal[Record in journal]
    Auto --> Journal
```

These diagrams are linked from the Foundations and relevant decision pages.
