# Documentation Style and Maintenance

This guide defines how Naro documentation is organized, written, and kept in
sync with implementation.

## Write for one user need

Use one primary content type per page.

| Type | User question | Required shape |
|---|---|---|
| Tutorial | “Can you teach me?” | guided, safe, runnable, successful outcome |
| How-to | “How do I accomplish this?” | focused steps, assumes basic competence |
| Explanation | “Why does this work this way?” | concepts, trade-offs, alternatives |
| Reference | “What exactly is supported?” | complete facts, signatures, defaults, failures |

Do not turn reference pages into tutorials or hide required reference facts in a
narrative chapter.

## Naro voice

Write directly and concretely.

Prefer:

- “The model proposes; the runtime authorizes.”
- “A timed-out write has an indeterminate external result.”
- “This implementation is single-host.”
- “Pass a policy explicitly.”

Avoid:

- marketing adjectives without evidence;
- generic introductions about AI changing the world;
- repeating an analogy in every section;
- saying “secure” without naming the boundary;
- saying “replay” when the behavior is journal inspection;
- presenting a reference implementation as distributed infrastructure.

## Page requirements

Every tutorial includes:

1. what the reader will build;
2. prerequisites;
3. complete commands and code;
4. expected output;
5. one deliberate failure exercise;
6. cleanup where needed;
7. links to concepts, reference, and production guidance.

Every how-to guide includes:

1. a single outcome;
2. assumptions;
3. ordered steps;
4. verification;
5. failure handling;
6. production boundary.

Every reference page includes:

1. public exports or configuration;
2. defaults;
3. failure behavior;
4. lifecycle or concurrency semantics;
5. durability and security boundary;
6. a source or test that establishes the claim.

## Claims follow code

Source and tests are authoritative. Before changing documentation:

1. read the current public interface;
2. read its contract and behavior tests;
3. run the smallest relevant example;
4. distinguish implemented behavior from deployment responsibility;
5. avoid documenting a branch that has not landed.

Fast-moving claims—events, decisions, capabilities, defaults, CLI flags, and
package exports—should eventually be generated or checked from source.

## Code samples

- Prefer complete examples under `examples/` for long programs.
- Keep inline snippets small enough to understand in one screen.
- Include required policy in every `AgentRunner` composition.
- Use fake credentials or environment references, never values.
- State whether code is runnable, abbreviated, or a composition sketch.
- Do not show `allowAllPolicy` without an explicit development-only warning.
- Compile or execute tutorial samples in CI when practical.

## Security language

Use a guarantee matrix:

| Say | Do not imply |
|---|---|
| worker-thread isolation | OS sandbox |
| destination allowlist | trustworthy remote content |
| timeout aborts a signal | external transaction rolled back |
| SQLite durable on one host | distributed high availability |
| at-least-once delivery | exactly-once side effects |
| JWT signature verified | tenant authorized |

Put warnings next to the step that introduces risk, not only in a final security
chapter.

## Links and navigation

Each page should link to no more than a handful of next steps:

- one deeper concept;
- one practical guide or example;
- one reference page;
- production guidance when the feature touches the world.

Use repository-relative links. Link package details to package READMEs rather
than copying the same reference table into many pages.

## Maintenance checklist

Before merging a documentation change:

- [ ] commands run from a clean checkout;
- [ ] snippets match current APIs;
- [ ] expected output matches behavior;
- [ ] internal links resolve;
- [ ] defaults and failure modes are stated;
- [ ] production limits are explicit;
- [ ] security-sensitive claims name the enforcement point;
- [ ] related package README is updated;
- [ ] historical research is not presented as current API;
- [ ] `npm run check` and `git diff --check` pass.

## Ownership rule

A public implementation change is incomplete until its closest README and any
user-facing guide are updated. If the change affects a universal runtime
invariant, update `docs/architecture.md`. If it changes a production guarantee,
update `docs/production-readiness.md`.
