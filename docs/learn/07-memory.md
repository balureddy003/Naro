# 07 — Memory

Context is what the model can see now. Memory is what the agent can retain and
recall across decisions, sessions, or longer periods.

Memory is not one feature and it is not one database. A scratchpad, an audit
log, a user preference, and a lesson from a failed deployment have different
lifetimes and trust requirements.

## Memory tiers

| Tier | Example | Lifetime | Typical access |
|---|---|---|---|
| working | intermediate values for this decision | one call or turn | prompt |
| session | observations from the current run | one run | in-process or fast store |
| episodic | “the last deploy failed during migration” | across runs | filtered or semantic recall |
| semantic | a verified service ownership fact | long-lived | structured or semantic lookup |
| procedural | a strategy that worked for a recurring task | long-lived | skill or strategy registry |
| long-term log | complete audit history | retention policy | append and inspect |

These names are useful because they force a design question: what kind of thing
are we remembering, and why?

## Write policy matters more than storage

The dangerous version of memory is “save everything the model says.” A model
claim is not automatically a fact, and a tool result may contain hostile text.

A good write path records:

- provenance: where did this information come from?
- scope: which user, tenant, agent, or goal owns it?
- confidence or verification state;
- creation and expiry time;
- sensitivity and deletion requirements.

Recall needs policy too. The best semantic match may belong to the wrong tenant
or may have expired.

## In Naro

The runtime already keeps tasks, observations, and retrieved context for the
current run. Checkpoints persist that run state when a checkpoint store is
configured.

Longer-lived memory lives in `@naro/memory`. The `MemoryStore` contract supports
write, read, search, tier-scoped search, and forget. Naro includes:

- `InMemoryMemoryStore` for tests and process-local use;
- `FileMemoryStore` for JSONL persistence without external infrastructure;
- `SqliteMemoryStore` for durable, transactional storage with FTS5/BM25
  full-text recall — the option for a single-host agent that needs memory
  to survive a restart without adding an external database.

Reasoners receive memory through `ctx.memory`, exposed as the smaller
`MemoryReader` interface. That separation is intentional: a reasoning strategy
may recall memories, but the store does not decide what deserves to be written.

```ts
const hits = await ctx.memory?.search('previous deployment failures', 5);
```

`FileMemoryStore` and `SqliteMemoryStore` also implement the optional
`EmbeddingIndex` port — `searchByEmbedding(embedding, limit, tier?)` — so an
entry written with an `embedding` (from any `Model.embed()`) can be recalled
by semantic similarity, not just lexical match. Scoring is cosine similarity
in application code; a dedicated vector database (Qdrant, pgvector) is a
separate `MemoryStore` adapter behind the same contract once a store
outgrows an in-process scan.

## Memory is not RAG with a new label

Both systems retrieve information, but their ownership differs:

- RAG usually retrieves from an external source of record.
- Memory usually contains information produced or selected by prior agent
  activity.

That makes memory easier to poison. An injected document can influence one run;
a bad memory can influence every later run that recalls it.

## Failure modes

**Memory poisoning.** Verify important facts before promoting them to semantic
memory. Preserve the original source.

**Unbounded growth.** Apply retention, compaction, and tier-specific expiry.
More memories can make recall worse.

**Cross-tenant leakage.** Enforce scope in storage queries, not after results
reach the model.

**Stale preferences or facts.** Store timestamps and replacement rules. “The
user prefers X” needs a way to become false.

**Deletion that only hides data.** If users can request deletion, make sure
backups, indexes, and derived stores follow the policy.

## Design exercise

For each candidate memory, finish this sentence:

> Remember this because ___, until ___, for ___, based on evidence from ___.

If those blanks are unclear, do not write the memory yet.

## Try it

Save this as `try-memory.ts` in the repo root (it needs `@naro/memory`
resolvable from `node_modules`, so it has to live inside the checkout)
and run it with `node try-memory.ts`:

```ts
import { SqliteMemoryStore } from '@naro/memory';

const memory = new SqliteMemoryStore('.naro/try-memory.db');
await memory.write({
  key: 'deploy-policy',
  content: 'deploy to prod requires two approvals',
  tier: 'semantic',
  source: 'runbook.md',
});
const hits = await memory.search('deploy approvals', 5);
console.log(hits);
```

You should see one hit with a near-1.0 score. Open
`memory/src/sqlite-store.ts` to see the FTS5 query and its
substring-scoring fallback when a query isn't FTS-safe — a good example
of a store degrading gracefully instead of throwing on unusual input.

## Check yourself

- An agent writes "the API rate limit is 100 req/s" to semantic memory
  after reading a tool's error message. What's missing from that write
  that this page said every write needs?
- Why is memory *easier to poison* than RAG, even though both retrieve
  information into context?
- A user asks to delete their data. Name two places besides the primary
  memory store where that fact needs to propagate.

Next: [Agent loops and state machines](08-agent-loops.md).
