# chat-demo — the chat UI against real PRD-002 templates

A `naro serve` module wiring the transaction categorizer and invoice
extractor to `/chat` (PRD-006). Vendor-history and document reads are
gated behind a human — the approval card shows up in the transcript.

## Run it

```bash
npm run build                        # once — chat-ui + client ship as dist ESM
npx naro serve examples/chat-demo/src/index.ts \
  --port 8080 \
  --principals principals.json \
  --approvals ./data/approvals.db
```

`principals.json` is a token→identity map (see `naro serve --help`):

```json
{ "my-token": { "id": "me@example.com", "roles": ["admin"] } }
```

Then open **http://localhost:8080/chat**, paste `my-token`, pick a
template, send a goal like `Categorize STAPLES #441 $214.10`. The run
pauses on the approval card — approve it and the verified result lands.

## Models

- Default: `qwen2.5:3b` via the local Ollama cheap tier
  (`ollama serve` + `ollama pull qwen2.5:3b`). Override with
  `NARO_OLLAMA_MODEL`.
- `NARO_DEMO_MOCK=1` — scripted `MockModel`, no GPU needed.

## Live identity (ADR 0025)

Add `--principals-store ./data/principals.db` *alongside* `--principals`
(don't drop `--principals` — see below) and the Access tab's "Generate
access" issues real tokens that work on the next request, no restart:

```bash
npx naro serve examples/chat-demo/src/index.ts \
  --port 8080 \
  --principals principals.json \
  --principals-store ./data/principals.db \
  --approvals ./data/approvals.db
```

**Keep `--principals` even once the store is live.** `POST
/admin/principals` itself needs an admin bearer token to call, so a
`--principals-store` alone, with nothing seeded in it yet, has no path
to ever authenticate anyone — not even the deployment's own owner.
`my-token` from `principals.json` stays your bootstrap/break-glass admin
account; everyone you invite afterward through the Access tab gets a
real, store-backed, individually-revocable token instead.
