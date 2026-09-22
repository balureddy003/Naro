# Contributing to Naro

Naro is young (v0.1.0, single maintainer) and the bar is architectural
honesty over breadth. Read this before opening a PR — it will save you a
round trip.

## Before you write code

- **Bug fix or small, local change** (a wrong error message, a missing
  test, a doc that no longer matches the code): open a PR directly.
- **New capability, new package, or anything touching the runtime's
  state machine, event schema, or a public contract** (`PolicyEngine`,
  `Verifier`, `CheckpointStore`, `ContextProvider`, …): open an issue first
  describing the change and the problem it solves. Changes that shape the
  kernel get an [ADR](docs/adr/README.md) — see its template — not just a
  PR description.
- **Speculative abstractions, unrequested feature flags, or "while I was
  in there" refactors**: don't. [docs/principles.md](docs/principles.md)
  is the review rubric; a PR that fails it gets asked to shrink, not
  merged with follow-ups promised.

If you're unsure which bucket you're in, open an issue and ask — that's
what issues are for.

## Development setup

Requires **Node 24+** (`node:sqlite` and native TypeScript type-stripping
are both load-bearing — see [ADR 0006](docs/adr/0006-core-depends-only-on-node.md)
for why the kernel stays dependency-free).

```bash
git clone https://github.com/balureddy003/naro.git
cd naro
npm install
npm run check   # tsc -b (build, every package) + node --test (every test)
```

Run one package's tests while iterating:

```bash
node --test "runtime/src/**/*.test.ts"
```

Postgres-backed adapters (`@naro/adapter-pg`) have their own suite that
needs a live database — CI runs it against a `postgres:17` service
container; skip it locally unless you're touching that adapter.

## What a PR needs

- **Tests.** A behavior change without a test is a change nobody can
  verify hasn't regressed six months from now. New ports (a store,
  a policy engine, a tool source) that replace an existing interface
  should pass the shared suite in `@naro/contract-tests`, not just their
  own tests.
- **`npm run check` green**, including `pack:check` (verifies every
  package's published shape — see `scripts/pack-check.mjs`).
- **Docs updated in the same PR**, not a follow-up. Per
  [docs/documentation-style.md](docs/documentation-style.md)'s ownership
  rule: a public change is incomplete until its closest package README
  is updated; a runtime invariant touches `docs/architecture.md`; a
  production guarantee touches `docs/production-readiness.md`.
- **A changeset**, if the change affects a published package's behavior
  or public API: `npm run changeset` and follow the prompts. Internal
  refactors and doc-only changes don't need one.
- **No unrelated formatting churn.** Keep the diff to what the PR is
  about — reviewing a real change is hard enough without separating it
  from a reflow.

## Commit and PR style

- Commit messages: imperative mood, explain *why* when it isn't obvious
  from the diff (`git log` for the house style).
- Keep the model/loop/gate distinction intact: reasoning proposes,
  policy authorizes, the executor acts, a verifier checks. If your
  change lets any of those steps be skipped or merged, it needs an ADR
  and a strong reason, not just a passing test.
- New public surface should read like the rest of the codebase's
  comments: explain the non-obvious *why* (a hidden constraint, a
  rejected alternative), not the *what* a good name already says.

## Reporting bugs and requesting features

Use the issue templates — they ask for the reproduction and context a fix
actually needs. See [SECURITY.md](SECURITY.md) instead for anything that
looks like a vulnerability (a policy bypass, a way to forge or extend a
sealed journal undetected, a way to escape a profile's declared
boundary) — please don't file those as public issues.

## Code of conduct

Be direct about the work, generous about the person. Disagreement over
architecture is expected and welcome; personal attacks, harassment, or
bad-faith arguing are not, and will get a thread closed or a contributor
blocked. Report anything that crosses that line by opening a private
[security advisory](https://github.com/balureddy003/naro/security/advisories/new)
or contacting the maintainer directly if you'd rather not use GitHub.
