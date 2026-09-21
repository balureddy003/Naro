# Research agent

Provenance as a policy input, end to end — runnable offline (MockModel).

```sh
npm run example:research
```

## What it does

A research agent is asked to fetch a page and answer a question. The fetched
page is real evidence — and carries an injected instruction telling the
agent to call a destructive tool.

1. **Allowlist** — the model first tries `evil.example.net`; the
   environment refuses it outright (`net.fetch` never reaches the network).
2. **External trust** — the allowlisted fetch lands as an observation with
   `trust: 'external'` and the transcript wraps it in the
   `UNTRUSTED OUTPUT` banner.
3. **Provenance gate** — the model then requests `purge_notes` (the
   injection) and `add_citation` in one batch. `purge_notes` is *granted*;
   `createToolPolicy({ denyExternalTriggered: ['destructive'] })` denies it
   anyway because the previous iteration's evidence was external. The
   citation proceeds.
4. **Verification** — the runner calls the verifier per action *and* on
   the completion claim; `perAction` scopes the citation-backing check to
   `add_citation` observations, `atCompletion` scopes the answer check to
   the final result.
5. **The proof** — `formatEvidence` prints the gate → observation →
   verifier chain; `verifyChain` confirms the journal.

Expected output sketch:

```text
gate   tool://web_fetch
obs    tool://web_fetch trust=tool ok=false      # allowlist refusal
gate   tool://web_fetch
obs    tool://web_fetch trust=external ok=true
gate   tool://purge_notes
DENIED tool://purge_notes — destructive side effect triggered by external evidence (tool://web_fetch)
gate   tool://add_citation
obs    tool://add_citation trust=tool ok=true
status=completed
  act_… [tool.invoke] denied (destructive side effect triggered by external evidence (tool://web_fetch)) → not executed → unverified
goal: verified by research
chain: OK
```

No action line reports `verification FAILED` and no `REPLAN` line appears —
each predicate only runs in the phase it checks.
```

## Caveat — the window is one iteration

`ctx.provenance` is computed over the *previous* iteration's observations
(see ADR 0010, Consequences). If the model had first done an unrelated
read and *then* requested the purge, the rule would not fire and the
destructive tool would fall back to `require_approval` instead of an
outright deny.
