import type { NaroClient } from '@naro/client';

/**
 * The one seam between this bundle and the SDK: `naro serve` exposes
 * `@naro/client`'s compiled ESM at GET /client/*.js (the same route the
 * ops console's <script type="module"> imports from). The specifier is a
 * variable on purpose — a literal '/client/index.js' import would be a
 * module TS can't resolve at compile time; typed after the fact against
 * the package's own module shape, which is the same wire contract.
 */
const url = '/client/index.js';
export const sdk = await import(url) as typeof import('@naro/client');

export type Client = NaroClient;
