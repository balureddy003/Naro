# CLAUDE.md

Context for any agent (Claude Code or otherwise) working on this repository.
`profiles/coding`'s `RepoContextSource` reads this file as query-independent
context for agents Naro governs — including, if you're reading this as
Claude Code working on Naro's own source, you.

## What this is

Naro is an agent runtime where authorization and verification are states in
the agent's own state machine, not callbacks a developer remembers to add.
See [README.md](README.md) for the pitch and [docs/README.md](docs/README.md)
for the full documentation map, sorted into beginner/practitioner/expert
tracks.

## Before changing code

1. Read [docs/principles.md](docs/principles.md) and
   [docs/architecture.md](docs/architecture.md)'s §15 "Code-level extension
   rules" and "Review invariants" — this is the actual review rubric, not
   a style guide. A change that fails these invariants gets asked to
   shrink, not merged with a follow-up promised:
   - core stays domain- and vendor-neutral;
   - the runtime is the only owner of agent state transitions;
   - every action passes policy before execution;
   - reasoners return decisions, they never execute capabilities directly;
   - actions and observations stay separate — intent vs. evidence;
   - failures stay visible as observations, events, or terminal results;
   - optional capabilities are declared and checked, never guessed;
   - context and memory retain provenance and scope;
   - completion is verified when evidence matters;
   - adapters translate protocols without leaking vendor types inward;
   - loops, retries, context, and external calls are bounded;
   - docs distinguish an included implementation from a deployment
     responsibility.
2. Read [CONTRIBUTING.md](CONTRIBUTING.md) for which changes need an issue
   or an [ADR](docs/adr/README.md) first, versus a direct PR.
3. Find the right home for new code in architecture.md §15's extension
   table before creating a package — most things are a `profile`, an
   `adapter`, or belong in an existing package, not a new one.

## Commands that matter

```bash
npm install && npm run build   # tsc -b — project-referenced, dependency order matters
npm test                       # full suite across every workspace
npm run check                  # build + test + pack:check — what CI runs
node cli/src/bin.ts states     # print the 17-state transition table
node cli/src/bin.ts bench benchmarks/smoke.ts --baseline benchmarks/baseline.jsonl
node cli/src/bin.ts verify <run.jsonl>   # hash-chain + evidence record
```

A behavior change without a test is unverifiable six months from now — see
CONTRIBUTING.md's "What a PR needs."

## This repo governs its own development

`.claude/hooks/` + [`dogfood/`](dogfood/README.md) run this repo's own
policy gate (`@naro/adapter-harness`) beneath Claude Code's own
`PreToolUse`/`PostToolUse` hooks: `Bash` commands are gated (force-push,
`git reset --hard`, hook-bypass flags, and repo-root `rm -rf` are denied;
pushing to `main`, publishing, and merging PRs require approval; everything
else is allowed and journaled), and the session produces a hash-chained,
`naro verify`-able record at `.naro/dogfood-journal.jsonl`. This is Naro
dogfooding itself — see `dogfood/README.md` for the full picture, including
its honest scope (fail-open by design; not a hard security boundary yet).

## Style

Comments explain *why*, not *what* — a hidden constraint, a rejected
alternative, a subtle invariant. See
[docs/documentation-style.md](docs/documentation-style.md) for the doc
voice this project holds itself to; the same directness applies to code
comments and commit messages.
