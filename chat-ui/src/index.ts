// @naro/chat-ui — PRD-006's chat interface. The node-facing surface is
// just the shell string + the template-manifest type `naro serve`
// injects; the app itself is browser ESM served under /chat-ui/*.js.
export { CHAT_UI_HTML } from './shell.ts';
export type { ChatTemplate } from './app.ts';
