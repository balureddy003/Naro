# @naro/contract-tests

The "replaceable" promise, made executable. Shared test suites that every implementation of a Naro port must pass — call them from your package's own test file.

## Usage

```ts
import { checkpointStoreContract } from '@naro/contract-tests';
import { MySqlCheckpointStore } from './my-store.ts';

checkpointStoreContract('MySqlCheckpointStore', () => new MySqlCheckpointStore(opts));
```

## Suites

| Suite | Asserts |
|---|---|
| `checkpointStoreContract` | empty `latest()`, save→latest roundtrip, most-recent wins, per-agent isolation |
| `policyEngineContract` | returns a valid `PolicyDecision`, deterministic shape |
| `eventExporterContract` | empty batches OK, seq order preserved across concurrent exports (durable sinks) |
| `toolSourceContract` | discovered tools have name/schema/execute, names unique |
| `toolTrustContract` | a tool wrapping an environment stamps trust no higher than the env's observation (external stays external) |

## Design

Structural mirror types (`CheckpointStoreLike`, …) — the kit depends only on `@naro/core`, so consumers never create dependency cycles. If your implementation satisfies the real interface, it satisfies the structural one.
