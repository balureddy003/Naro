---
"@naro/adapter-slack": minor
---

New package: `slackTools({token})` — `slack_post_message`,
`slack_list_channels`, `slack_read_channel` as `@naro/tools` `Tool`s, with
honest `permissions`/`sideEffects`, and `trust: 'external'` on
`slack_read_channel` (message content other Slack users authored, the
same provenance boundary `@naro/profile-research`'s `web_fetch` draws —
see ADR 0010). One concrete, well-built instance of the "business system
connector" pattern — a template to replicate for Jira/ServiceNow/CRM
connectors, not a claim of broad coverage.
