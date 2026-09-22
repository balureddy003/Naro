# Security Policy

Naro's entire pitch is that authorization and verification are structural
— so a bug that lets either be bypassed is more serious here than it
would be in most projects. Please report responsibly.

## Supported versions

Naro is pre-1.0 (`v0.2` worktree, `0.1.0` packages, not yet published).
There is one supported line: **the `main` branch.** There is no LTS
release and no backport policy yet — a fix lands on `main` and that's
the version you should be running.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security bug.** Use one of:

1. [GitHub Security Advisories](https://github.com/balureddy003/naro/security/advisories/new)
   for this repository — the preferred channel. It's private by
   default and lets us coordinate a fix and a disclosure date with you
   before anything becomes public.
2. If you don't want to use GitHub, contact the maintainer directly and
   mark the message confidential.

Please include:

- which package(s) are affected (e.g. `@naro/runtime`, `@naro/policy`,
  `@naro/adapter-harness`);
- a minimal reproduction — a failing test against the relevant contract
  suite in `@naro/contract-tests` is ideal, since it doubles as the
  regression test for the fix;
- what the bypass or forgery actually achieves (e.g. "an action executes
  without a policy verdict," "a chain forged after tampering still
  verifies," "a sealed journal accepts a post-seal event") rather than
  just "this seems insecure."

## What counts as a security issue here

Given Naro's own [design principles](docs/principles.md) and
[production-readiness guarantees](docs/production-readiness.md), these
are in scope and high priority:

- **Authorization bypass** — an action reaches `ACTING` without a
  `PolicyEngine` verdict, or a denied/unapproved action executes anyway.
- **Verification bypass** — a `complete` decision reaches `COMPLETED`
  without a configured verifier's evidence check passing, or a rejected
  verification doesn't force `REPLANNING`.
- **Hash-chain or seal forgery** — `verifyChain()` / `naro verify`
  accepts a tampered, reordered, truncated, or post-seal-extended
  journal as valid, or a forged Ed25519 signature verifies against the
  wrong key.
- **Profile boundary escape** — the coding profile's workspace jail,
  the research/browser profile's destination allowlist, the data
  profile's read/write split, or the robotics profile's estop latch can
  be bypassed from inside the declared capability set.
- **Provenance/injection controls** — `denyExternalTriggered` fails to
  deny a side effect actually triggered by untrusted (`external`-trust)
  content.
- **Secret handling** — a resolved secret value lands in an event,
  observation, log, or error message instead of staying inside
  `ExecContext.secrets` resolution.
- **Control-plane auth** — `naro serve`'s `--principals`/`--token` gate
  can be bypassed, or a `viewer` principal can reach an `operator`- or
  `approver`-gated endpoint.

## What is a known, documented limitation, not a vulnerability

Please still report these if you find a *new* way to exploit them, but
they are already disclosed as boundaries a deployment must own — see
[production-readiness.md](docs/production-readiness.md):

- `SandboxedExecutor` is worker-thread isolation, **not** an OS sandbox
  — a worker can reach the host filesystem and network. Run untrusted
  code behind a container, VM, or external sandbox.
- The hash chain is tamper-*evident*; a sealed journal is
  tamper-evident *with attribution*. The sealing key itself can still
  forge a self-consistent chain — key custody (KMS/HSM) is the
  deployment's responsibility, not the kernel's.
- `naro serve`'s bearer/principal checks are a control-plane role gate,
  not multi-tenant authorization — tenant isolation belongs to the
  deployment in front of it.
- Cancellation is not rollback; a timed-out write may have already
  committed externally. Idempotency keys are supplied; enforcing them
  is the target system's job.

## Disclosure

We'll acknowledge a report within a few days, work with you on a fix
and a coordinated disclosure timeline, and credit you in the advisory
unless you'd rather stay anonymous. Given the single-maintainer bus
factor noted in [docs/market-quadrant.md](docs/market-quadrant.md), a
turnaround measured in days rather than hours is realistic — please
account for that when deciding how long to hold a public write-up.
