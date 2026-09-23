---
"@naro/evaluation": minor
---

Add `exportTrainingExamples(events, options?)` and `toJsonl(examples)`.

Turns a run's event stream into SFT-ready `TrainingExample`s — the exact
`ChatMessage[]` transcript a model would have seen, built by
`@naro/reasoning`'s `buildMessages()` rather than a second, divergent
renderer. Only runs whose completion was verified
(`buildEvidence(...).goalVerification.ok === true`) are exported by
default, matching Naro's own thesis that a claim without verification
isn't evidence — pass `{ verifiedOnly: false }` to opt out.

`@naro/evaluation` now depends on `@naro/reasoning` and `@naro/model`.
