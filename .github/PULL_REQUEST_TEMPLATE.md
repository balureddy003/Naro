## What and why

<!-- The problem, not just the change. Link the issue if there is one. -->

## Scope

- [ ] Local change (bug fix, doc fix, test) — no new public contract
- [ ] New capability behind an existing contract
- [ ] New public contract or kernel-level change — linked ADR: <!-- docs/adr/NNNN-... -->

## Checklist

- [ ] `npm run check` passes locally (build + full test suite + `pack:check`)
- [ ] New/changed behavior has a test — contract-suite coverage
      (`@naro/contract-tests`) if this replaces or adds a port implementation
- [ ] Docs updated in this PR: closest package README /
      `docs/architecture.md` (runtime invariant) /
      `docs/production-readiness.md` (production guarantee) — whichever apply
- [ ] Changeset added (`npm run changeset`) if this changes a published
      package's public behavior — not needed for internal-only or doc-only
      changes
- [ ] No unrelated formatting or reflow in the diff

## Verification

<!--
How you confirmed this works beyond the test suite passing — e.g. ran the
relevant example (`npm run example:*`), reproduced the original bug and
confirmed the fix, or checked the new CLI flag against `naro serve --help`.
-->
