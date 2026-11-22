# Where to Place Verification

## Options

| Placement | Pros | Cons | Recommendation |
|-----------|------|------|----------------|
| Runtime state (inside the loop) | Cannot be skipped; rejection forces replan; evidence is journaled | Requires the runtime to support it | **Preferred** for any system that must prove outcomes |
| Post-hook / middleware | Easy to add later | Easy to forget or bypass | Only for low-stakes prototypes |
| External system | Reuses existing checkers | Agent may already have acted; harder to replan | Use as a complement, not the only gate |

## Naro realization

Verification is a first-class state. A `complete` decision enters `VERIFYING`. Rejection moves to `REPLANNING` and records an observation the reasoner can see. The same path exists for per-action verification.

Recommendation: put the authoritative verification inside the runtime. External systems can supply additional evidence, but the kernel must still accept or reject.
