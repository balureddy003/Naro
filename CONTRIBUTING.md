# Contributing to Naro

Thanks for your interest. Naro is early and the bar is architectural honesty. Small, focused contributions are especially welcome.

## Good first contributions

- Improve or extend the [AI System Engineering Guide](docs/guide/README.md)
- Add or clarify examples
- Fix docs that have drifted from the code
- Add tests for existing behavior
- New domain profile or model adapter (open an issue first)

## Before you write code

- **Bug fix, docs, or small local change** → open a PR directly.
- **New capability, new package, or anything touching the state machine / public contracts** → open an issue first. Kernel-shaping changes need an [ADR](docs/adr/README.md).
- Unsure? Open an issue and ask.

## Development setup

Requires **Node 24+**.

```bash
git clone https://github.com/balureddy003/Naro.git
cd Naro
npm install
npm run check   # build + test + pack check
```

Run a single package’s tests:

```bash
node --test "runtime/src/**/*.test.ts"
```

## What a PR needs

- Tests for behavior changes
- `npm run check` green
- Docs updated in the same PR when public behavior changes
- A changeset (`npm run changeset`) if you change a published package’s API

## Commit style

Imperative mood. Explain *why* when it isn’t obvious.

## Security

See [SECURITY.md](SECURITY.md). Do not file vulnerabilities as public issues.

## Code of conduct

Be direct about the work, generous about the person. Disagreement on architecture is welcome; personal attacks are not.
