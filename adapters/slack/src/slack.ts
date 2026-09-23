import type { Tool } from '@naro/tools';

/**
 * Slack Web API as Naro tools — one instance of the "business system
 * connector" pattern: a well-known external API wrapped in the same
 * declarative-metadata contract every tool uses, so policy governs it
 * exactly like `shell.exec` or `sql.exec`. Not a claim of broad business
 * coverage — a template for it. The next connector (Jira, ServiceNow, a
 * CRM) follows the same shape: one `execute` per operation, honest
 * `sideEffects`, and `trust: 'external'` on anything that returns content
 * someone outside the system authored.
 */
export interface SlackOptions {
  /** Bot token ('xoxb-...'). Deployment config, resolved before this
   *  adapter is constructed — the same posture every model/policy adapter
   *  in this repo takes for its own credential, not a per-action secret
   *  ref (those are for what the *model* puts in a tool call's input). */
  readonly token: string;
  /** Default 'https://slack.com/api'. */
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

interface SlackResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

async function call(opts: SlackOptions, method: string, body: Record<string, unknown>): Promise<SlackResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? 'https://slack.com/api';
  const res = await fetchImpl(`${base}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} from Slack ${method}`);
  const json = await res.json() as SlackResponse;
  // Slack's Web API returns 200 even on failure — {ok: false, error: '...'}
  // is the real failure signal, and the one an Observation must carry.
  if (!json.ok) throw new Error(`slack.${method}: ${json.error ?? 'unknown error'}`);
  return json;
}

/**
 * Tools bound to one bot token. Register the ones a given agent actually
 * needs — granting `slack_post_message` doesn't require also granting
 * `slack_read_channel`, and policy should see them as distinct
 * permissions regardless.
 */
export function slackTools(opts: SlackOptions): Tool[] {
  return [
    {
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel or user. Returns the posted message\'s channel and timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID or name (e.g. "C0123ABCD" or "#general").' },
          text: { type: 'string' },
          threadTs: { type: 'string', description: 'Optional: reply in this thread.' },
        },
        required: ['channel', 'text'],
      },
      permissions: ['slack.postMessage'],
      sideEffects: 'write',
      async execute(input) {
        const { channel, text, threadTs } = input as { channel: string; text: string; threadTs?: string };
        const res = await call(opts, 'chat.postMessage', {
          channel, text, ...(threadTs !== undefined && { thread_ts: threadTs }),
        });
        return { channel: res['channel'], ts: res['ts'] };
      },
    },
    {
      name: 'slack_list_channels',
      description: 'List channels the bot can see. Returns {id, name, isPrivate}[].',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max channels to return, default 100.' } },
      },
      permissions: ['slack.listChannels'],
      sideEffects: 'read',
      async execute(input) {
        const { limit } = (input ?? {}) as { limit?: number };
        const res = await call(opts, 'conversations.list', { limit: limit ?? 100, exclude_archived: true });
        const channels = (res['channels'] as { id: string; name: string; is_private: boolean }[] | undefined) ?? [];
        return channels.map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private }));
      },
    },
    {
      name: 'slack_read_channel',
      description: 'Read recent messages from a channel. Returns {user, text, ts}[] — message text authored by Slack users, not this system.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          limit: { type: 'number', description: 'Max messages to return, default 20.' },
        },
        required: ['channel'],
      },
      permissions: ['slack.readChannel'],
      sideEffects: 'read',
      // Message content is authored by whoever posted in the channel —
      // the same "content the system didn't write" trust boundary
      // web_fetch draws for fetched pages. See ADR 0010: a policy rule can
      // deny a triggering observation's side effects on this basis.
      trust: 'external',
      async execute(input) {
        const { channel, limit } = input as { channel: string; limit?: number };
        const res = await call(opts, 'conversations.history', { channel, limit: limit ?? 20 });
        const messages = (res['messages'] as { user?: string; text: string; ts: string }[] | undefined) ?? [];
        return messages.map((m) => ({ user: m.user, text: m.text, ts: m.ts }));
      },
    },
  ];
}
