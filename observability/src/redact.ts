import type { NaroEvent } from '@naro/core';
import type { EventExporter } from './exporter.ts';

/**
 * Secrets must not leave the process in telemetry. `redacting()` wraps
 * any EventExporter and masks sensitive values before export — the
 * internal event stream stays complete, the external copy is safe.
 *
 * Two kinds of leaks get caught:
 *   - sensitive KEYS   — any field named token/secret/password/…
 *   - secret PATTERNS  — sk-…, Bearer …, AKIA…, private keys, etc.
 */

const SECRET_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'authorization', 'auth', 'credential', 'credentials', 'private_key',
  'client_secret', 'session', 'cookie',
]);

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,                    // OpenAI-style keys
  /Bearer\s+\S+/gi,                          // bearer tokens
  /AKIA[0-9A-Z]{16}/g,                       // AWS access keys
  /ghp_[A-Za-z0-9]{20,}/g,                   // GitHub PATs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];

const MASK = '[REDACTED]';

export function redact(value: unknown, extraPatterns: readonly RegExp[] = []): unknown {
  const patterns = [...SECRET_PATTERNS, ...extraPatterns];
  return walk(value, patterns);
}

function walk(v: unknown, patterns: readonly RegExp[]): unknown {
  if (typeof v === 'string') {
    let s = v;
    for (const p of patterns) s = s.replace(p, MASK);
    return s;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, patterns));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      SECRET_KEYS.has(k.toLowerCase()) ? MASK : walk(x, patterns),
    ]));
  }
  return v;
}

export function redacting(exporter: EventExporter, opts?: { patterns?: readonly RegExp[] }): EventExporter {
  return {
    export: (events) => exporter.export(events.map((e) => ({ ...e, data: redact(e.data, opts?.patterns) as never }))),
    flush: () => exporter.flush?.() ?? Promise.resolve(),
  };
}
