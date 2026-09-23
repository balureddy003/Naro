# @naro/adapter-slack

Slack Web API as `@naro/tools` `Tool`s — one instance of the "business
system connector" pattern, not a claim of broad business-system coverage.
The point of shipping this one concretely is the shape: every operation is
declarative metadata plus one `execute`, so policy governs a Slack post
exactly like it governs `shell.exec` or `sql.exec`. A Jira, ServiceNow, or
CRM connector follows the same shape.

## Usage

```ts
import { slackTools } from '@naro/adapter-slack';

const registry = new ToolRegistry();
for (const tool of slackTools({ token: process.env.SLACK_BOT_TOKEN! })) {
  registry.register(tool);
}
```

Grant only the permissions an agent actually needs — `slack.postMessage`,
`slack.listChannels`, `slack.readChannel` are independent, so granting one
doesn't imply the others.

## Tools

| Tool | Permission | Side effect | Trust |
|---|---|---|---|
| `slack_post_message` | `slack.postMessage` | `write` | — |
| `slack_list_channels` | `slack.listChannels` | `read` | — |
| `slack_read_channel` | `slack.readChannel` | `read` | `external` |

`slack_read_channel` returns message text other Slack users authored, not
content this system produced — the same reason `web_fetch` in
`@naro/profile-research` carries `trust: 'external'`. With
[ADR 0010](../../docs/adr/0010-provenance-is-a-policy-input.md) wired up
(`ctx.provenance`), a policy rule can deny a side-effecting action (like
`slack_post_message`) when it was triggered by evidence that came from a
channel message rather than the operator — the same prompt-injection
defense `@naro/profile-research` demonstrates for fetched web pages.

## Credentials

The bot token is deployment configuration passed to `slackTools({token})`
at startup — the same posture every model/policy adapter in this repo
takes for its own credential (`GeminiModel({apiKey})`,
`VaultSecretProvider({token})`). Resolve it from `@naro/tools`'s
`SecretProvider` chain (`EnvSecretProvider`, `VaultSecretProvider`, …)
before constructing `slackTools`, the same way you'd resolve any other
adapter's credential — this is distinct from the "secret references, never
values" rule for *action input*, which governs what the model puts inside
a tool call, not how the deployment wires up the tool itself.

## Failure behavior

- Slack's Web API returns HTTP 200 even on failure (`{ok: false, error}`)
  — this adapter treats that as a thrown error, not a silent no-op;
- an HTTP-level failure (non-2xx) also throws;
- `fetchImpl` is injectable — tests run offline against canned responses.
