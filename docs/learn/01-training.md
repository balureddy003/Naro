# 01 — Training (and Why Naro Does Not Do It)

Training changes a model's parameters. Naro uses the trained model through an
inference interface. Those are different systems, with different costs and
failure modes.

You do not need to train a model to build a capable agent. Most agent work is
about giving an existing model the right context, tools, constraints, and
feedback loop.

## From raw text to an assistant

```mermaid
flowchart LR
    A["large text corpus"] --> B["pre-training"]
    B --> C["base model"]
    C --> D["instruction tuning"]
    D --> E["preference or safety tuning"]
    E --> F["assistant model"]
    F -.-> G["optional domain adaptation"]
```

The real pipelines differ by model family, but these stages are useful mental
landmarks:

| Stage | What changes | What you get |
|---|---|---|
| pre-training | weights learn statistical structure from a large corpus | a base model that can continue text |
| supervised fine-tuning | weights learn from curated input/output examples | better instruction following |
| preference tuning | outputs are optimized toward ranked preferences | behavior people tend to prefer |
| adapter tuning, such as LoRA | a smaller set of trainable parameters is updated | cheaper specialization than full training |

Training cost varies wildly with model size, data, hardware, and technique.
Avoid rules such as “fine-tuning costs tens of dollars.” Sometimes it does.
Sometimes data preparation and evaluation cost far more than the compute.

## What training explains—and what it does not

**A model may sound confident when it is wrong.** Training rewards useful
continuations, not a guarantee that each sentence has been checked.

**A model has a knowledge boundary.** Facts represented in its weights reflect
its training data and later updates. For current or private information, use
[retrieval](04-rag.md).

**Fine-tuning is not a database.** It can teach style, format, or recurring
behavior. It is a poor replacement for records that must be retrieved exactly,
updated, deleted, or access-controlled. That is a [memory](07-memory.md) or
retrieval problem.

**Alignment is not authorization.** A model trained to refuse unsafe requests
may still be manipulated or simply make a mistake. Permission checks belong in
code, outside the model.

## Choose the cheapest mechanism that solves the problem

Use this order before reaching for fine-tuning:

1. Fix the instruction if the task is underspecified.
2. Add examples if the desired format or behavior is hard to describe.
3. Add retrieval if the model lacks current, private, or precise facts.
4. Add tools if the task needs computation or side effects.
5. Add evaluation so you can see what is actually failing.
6. Fine-tune when a stable, repeated behavior still does not improve enough.

This order is not ideology. It is a debugging strategy. Prompt, retrieval, and
tool changes are easier to inspect and reverse than weight changes.

## Where Naro draws the boundary

Naro's boundary is `Model`. An adapter may call a hosted service or a local
runtime such as Ollama, vLLM, or llama.cpp. Naro cares about the declared
capabilities and the request/response contract, not how the model acquired its
weights.

That separation gives you two useful freedoms:

- change the model without rewriting the agent loop;
- improve the agent without retraining the model.

## Production instincts

- Never assume training data stays private merely because it is “inside the
  model.” Memorization and extraction risks are real.
- Re-run safety and task evaluations after fine-tuning. Specialization can
  weaken behavior you relied on.
- Keep model versions explicit. A silent model upgrade is a production change.
- Compare cost per successful task, not cost per model call.

## Check your understanding

Suppose an agent gives outdated shipping rules. Fine-tuning might help, but a
versioned policy source retrieved at run time is usually the better design. It
can be updated immediately, cited, audited, and filtered by tenant.

Next: [Prompting and structured output](02-prompting.md).
