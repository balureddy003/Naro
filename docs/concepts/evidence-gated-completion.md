# Evidence-Gated Completion

*Explanation.* What it means for a run to be "done" in Naro, why the runtime
refuses to take the model's word for it, and how the journal lets a third party
check the outcome after the fact.

## The problem in one sentence

A language model that has finished a task will say so whether or not the task
is finished.

That is not a criticism of models; it is what "generate the most likely next
token" produces when the most likely next token is "Done." Every agent system
has to decide what to do with that sentence. Most treat it as the end of the
run. Naro treats it as a *claim*.

## Three questions, three mechanisms

An operator who did not watch the run needs answers to three questions. Naro
attaches one mechanism to each.

| Question | Mechanism | Where |
|---|---|---|
| Was the agent *allowed* to do that? | policy gate before every action | `WAITING_FOR_PERMISSION` state; `AgentRunner.gate()` |
| Did it *actually work*? | verifier after every action and after the completion claim | `VERIFYING` state; `Verifier.verify()` |
| Is this record *the* record? | hash-chained journal | `EventBus.emit()`; `verifyChain()` |

The first two are enforced by the state machine: there is no path from
`REASONING` to `ACTING` that skips the gate, and no path from a `complete`
decision to `COMPLETED` that skips `VERIFYING` when a verifier is configured.
The third is enforced by arithmetic: each event's `hash` covers its content and
its predecessor's hash, so changing, removing, or reordering any event changes
every hash after it.

## The lifecycle of a claim

```text
reasoner: { kind: 'complete', result }        ── a claim
   │
   ▼
VERIFYING  ── verifier.verify({ goal, result })
   │
   ├── ok      → COMPLETED        agent.completed { result }
   │
   └── not ok  → REPLANNING       observation { source: 'verifier', success: false, error: reason }
                    │
                    ▼
                REASONING  ── the reasoner sees the rejection as evidence
```

The rejection is not an exception and not a log line. It is an `Observation`
in the same list as tool results, so the next `decide()` call renders it in the
transcript and the model can respond to it: retry, take another route, ask a
human, or fail honestly.

Per-action verification has the same shape one level down: after `OBSERVING`,
`verifyAll()` runs the verifier over each observation; a failure enters
`REPLANNING` with an observation naming the verifier.

So `VERIFYING` happens in both phases — the *same* `Verifier` sees
`{ observation }` per action and `{ result }` on the completion claim. Wrap a
verifier in `atCompletion` or `perAction` (`@naro/verification`) when a check
only makes sense in one phase.

## What counts as evidence

A verifier is any implementation of:

```ts
interface Verifier {
  readonly id: string;
  verify(input: { goal: Goal; result?: unknown; observation?: Observation }):
    Promise<Verification> | Verification;   // { ok, reason?, evidence? }
}
```

`@naro/verification` ships six, in rough order of trustworthiness:

1. **Schema** — the result has the declared shape. Cheap, deterministic,
   catches malformed output, proves nothing about the world.
2. **Predicate** — a function you wrote returns ok. As strong as the function.
3. **Command** — a shell command exits 0. "The tests pass" is the canonical
   example. Strong when the command is the authority.
4. **Human** — a person accepts the claim. Slow, expensive, appropriate for
   irreversible outcomes.
5. **Composite** (`allOf`, `anyOf`) — layered requirements.
6. **LLM judge** — a model scores against a rubric. Useful for open-ended
   quality; never the sole gate on anything that matters, because it has the
   failure modes you are verifying against.

The principle in [principles.md](../principles.md): prefer schemas,
predicates, commands, sensors, or human review over a model judge.

## The proof bundle

After a run, the journal contains every fact needed to reconstruct what
happened. `buildEvidence(events)` (`@naro/observability`) joins those facts
into one record:

```text
run run_8f2… (coding-agent) — 42 events
chain: OK (42 chained events, head 3a9c1e07f2ab…)
  act_01 [tool://read_file]   permitted → observed ok → verified by schema
  act_02 [tool://run_command] approved → observed ok → verified by command
  act_03 [tool://write_file]  permitted → observed ok → unverified
  act_04 [tool://delete_file] denied (missing grants: fs.delete) → not executed → unverified
goal: verified by command — npm test exited 0
outcome: completed
```

Each row is a join over the [separate](../adr/0002-action-and-observation-are-separate.md)
`Action` and `Observation` records plus the policy and verification events for
that action id — `gate → observation → verification`, reading left to right.
`approved` means the policy required human approval and a human granted it;
`unverified` means no verifier judged that action. The record answers the
three questions per action, and the `chain` line says whether the file it was
built from is intact.

`naro verify <run.jsonl>` prints this and exits non-zero when the chain is
broken or absent.

## What the chain does and does not guarantee

The chain is **tamper-evident**: any edit to a stored event is detectable by
anyone holding the file.

It is **not tamper-proof** on its own: a writer with access to the whole file
can rewrite every hash consistently. `journal.sealed` closes most of that
gap — the run's terminal event is an Ed25519 signature over the chain head,
so a rewritten or extended journal fails signature verification for anyone
holding the public key (`naro verify file.jsonl --pubkey key.pem` pins the
expected key). The trust boundary moves to key custody: whoever holds the
sealing key can still forge a consistent chain, so production deployments
should keep it in a KMS/HSM and separate it from the journal writer, or
stream events to a store the writer cannot modify.

A journal written before chaining existed has no `hash` fields. `verifyChain`
reports it as `ok: false` with reason `journal is not hash-chained`. It does
not pass silently.

## Where this sits among alternatives

Orchestration frameworks let you build a verify step as a graph node; the
difference is that in Naro you cannot *not* build it — a configured verifier is
in the topology. Security kernels gate actions and keep an audit log but stop
at "the action was permitted and ran"; they do not ask whether it worked.
Harness SDKs verify implicitly by running tests when the model chooses to.
Naro's position — verification as a state, evidence as a record, journal as a
chain — is spelled out in [positioning.md](../positioning.md).

## Try it

1. Run the coding example: `npm run example:coding`.
2. Pipe a run to JSONL (see the how-to on exporting events) and run
   `naro verify run.jsonl`.
3. Open the file, change one character inside any `"data"` payload, run
   `naro verify` again, and read the `brokenAt` line.
4. Attach a `CommandVerifier` that always fails and watch the run enter
   `REPLANNING` instead of `COMPLETED`.

## Related

- [ADR 0001 — Verification is a runtime state](../adr/0001-verification-is-a-runtime-state.md)
- [ADR 0005 — Hash chain in the event bus](../adr/0005-hash-chain-in-the-event-bus.md)
- [Learn 10 — Evaluation](../learn/10-evaluation.md)
- [`@naro/verification` reference](../../verification/README.md)
