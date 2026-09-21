# Governed agent

The moat, end to end: policy gate + verifier + hash-chained journal +
`wake()` + an Ed25519-sealed head — runnable offline (MockModel).

```sh
node examples/governed-agent/src/index.ts
```

## What it does

1. **Phase 1** — a coding agent on a temp workspace reads `answer.txt`,
   then pauses mid-run (the "crash").
2. **Phase 2** — a *different* runner calls `wake()` on the SQLite journal:
   no checkpoint, no shared memory. It replays the session, finishes the
   goal, the `CommandVerifier` runs `grep -q 42 answer.txt` as evidence,
   and the journal is sealed.
3. **The proof** — `formatEvidence` prints the policy verdict → observation
   → verifier chain per action, `verifyChain` confirms all events link, and
   the seal verifies against `seal.pub`:

   ```sh
   naro verify journal.jsonl --pubkey seal.pub
   ```

Swap `MockModel` for `new AnthropicModel(...)` and nothing else changes —
policy, verification, journal, and seal are all below the model.
