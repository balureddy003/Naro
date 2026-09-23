# @naro/chat-ui

PRD-006's chat interface — a template is **one object** with **Runs /
Settings / Access** tabs on it (GitHub's repo model applied to outcome
templates), not three separate role shells.

- **Chat-shaped:** a typed message → `client.submitGoal()`, the response
  streams via `watchRun` — tool calls render as inline chips, approvals
  as bordered decision cards, terminal events as the final message.
- **Evidence is opt-in, never absent:** every chip expands in place to
  the same fields the ops console renders — policy verdict, verifier
  result, chain hash — because it's built on `@naro/client`'s wire types,
  not a simplified restatement.
- **Self-deployable:** compiled to plain ESM by `tsc` (no bundler, no
  framework, no CDN) and served by `naro serve` the same way the console
  is — `GET /chat` for the shell, `GET /chat-ui/*.js` for the module
  graph, `/client/index.js` for the SDK.

## Layout

| File | Role |
|---|---|
| `src/shell.ts` | `CHAT_UI_HTML` — the static page (CSS + skeleton) |
| `src/app.ts` | boot, auth (`GET /me`), hash router, sidebar-of-objects |
| `src/chat.ts` | the Runs tab: transcript, chips, approval cards, stop control, chain banner |
| `src/pages.ts` | System pages (ADR 0024's writes + fleet halt), Settings/Access tabs, setup wizard |
| `src/viewmodel.ts` | journal → transcript shaping (pure — what the tests exercise) |
| `src/copy.ts` | jargon-free copy map |
| `src/sdk.ts` | the `/client/index.js` dynamic-import seam |

## How it's served

`startAgentServer(..., { chatTemplates })` injects the deployment's
template manifest into the shell page (no endpoint exposes it); runs
group under a template when their `specName` is `tpl:<id>`. Set
`chat: false` / `--no-chat` to disable the route.

## What's deliberately not here

Per PRD-006's non-goals: no model/policy/reasoner config surface, no
chat-product features (uploads, history search, multi-modal), no
endpoints beyond what ADR 0022/0024/0025/0026 specify. Settings-tab and
wizard choices are UI-only until PRD-002/004 define a persisted
template-config shape.
