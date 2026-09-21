# 0006 — `@naro/core` imports nothing beyond `node:` builtins

Status: accepted
Date: 2026-09-20

## Context

The kernel is the part of Naro every other package, profile, adapter, and
downstream application depends on. Any dependency it takes is a dependency
everyone takes: its supply chain, its release cadence, its breaking changes,
its install size. Agent frameworks that let a vendor SDK into the core have
spent the following year unpicking it.

## Decision

`core/` may import only `node:` builtins. No provider SDK, no schema library,
no logging library, no utility package. Types that describe external systems
(`Model`, `Tool`, `Environment`, `PolicyEngine`, `Verifier`, `ContextProvider`,
`MemoryReader`, `CheckpointStore`) are declared in core as interfaces; the
implementations live in sibling packages and adapters.

The same principle applies one ring out: `@naro/runtime`, `@naro/tools`,
`@naro/observability`, and the profiles depend on core and each other, not on
vendors. Vendor code lives only under `adapters/`.

This is a review rule in [principles.md](../principles.md) ("Does `core/`
import anything beyond `node:` builtins? It must not.").

## Alternatives considered

- **Take small, stable dependencies (a JSON Schema validator, a hashing lib).**
  Rejected: "small and stable" is a snapshot. `tools/src/schema.ts` implements
  the subset of JSON Schema Naro needs; `core/src/chain.ts` uses
  `node:crypto`. Both are a few dozen lines and fully under review.
- **Put vendor types behind `unknown`.** Rejected as insufficient: types are
  only part of the coupling; runtime imports are the rest.

## Consequences

- Core is small enough to read in one sitting, which is the point: it is the
  contract every port is tested against (`@naro/contract-tests`).
- Some conveniences are re-implemented (canonical JSON, schema validation,
  id generation). Each is deliberately minimal and documented as a contract
  boundary where an adapter can substitute a full library.
- Node.js is the runtime floor. `node:sqlite` in the durability tier raises
  that floor to Node 22+; core itself needs less, but the repository tests
  with what the durability tier needs.
- A pull request adding a dependency to `core/package.json` is rejected by
  review, not by tooling — adding a lint for it is cheap and should be done.
