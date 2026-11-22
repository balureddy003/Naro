# Why evidence-gated?

Most agent demos work. Most agent projects that try to leave the demo do not.

The usual failure is not the model. It is that nothing in the runtime forces three things:

1. **Authorization before the action**
2. **Verification of the outcome**
3. **A record you can check later**

Naro makes those three structural.

## Authorization is a state

Every action enters `WAITING_FOR_PERMISSION`. The model cannot self-authorize. Unknown tools are denied. Destructive actions can require approval. The policy engine is required — there is no silent default that allows everything.

## Verification is a state

A `complete` decision is a claim. The runner enters `VERIFYING`. If the verifier rejects the evidence, the runner moves to `REPLANNING` and the reasoner sees why. Completion is not trusted by default.

## The journal is the proof

Every event is hash-chained. `naro verify` recomputes the chain. Optional Ed25519 sealing signs the head. The evidence record joins policy verdict → action → observation → verifier verdict. You can show an auditor what was attempted, what was allowed, what happened, and whether it was accepted.

## What this is not

Naro is not a hosted platform, a low-code builder, or a replacement for your model provider. It is the kernel that sits under the loop and refuses to treat success as a string the model emitted.

If you need to prove what an agent did, start here:

- [AI System Engineering Guide](../guide/README.md)
- [Build your first safe agent](../getting-started.md)
- Run `npm run example:governed`

That is the difference between a demo and something you can operate.
