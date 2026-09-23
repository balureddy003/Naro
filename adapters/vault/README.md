# @naro/adapter-vault

HashiCorp Vault adapter for secret resolution — the `'vault:…'` provider
`@naro/tools`'s `secrets.ts` names as an extension point of `chainSecrets()`.

## Why this exists

Naro's rule is that actions carry secret *references* (`'env:OPENAI_API_KEY'`),
never values — the executor resolves them just-in-time via `ctx.secrets`, so
credentials never appear in transcripts, checkpoints, events, or
observations. `@naro/tools` ships `EnvSecretProvider`, `FileSecretProvider`,
and `MapSecretProvider` for zero-infrastructure cases; this adapter is the
centralized-secret-manager option for deployments that already run Vault.

## Usage

```ts
import { VaultSecretProvider } from '@naro/adapter-vault';
import { chainSecrets, EnvSecretProvider } from '@naro/tools';

const secrets = chainSecrets(
  new VaultSecretProvider({
    url: process.env.VAULT_ADDR!,
    token: process.env.VAULT_TOKEN,   // or omit and inject auth via `headers`
    mount: 'secret',                  // KV v2 mount point, default 'secret'
  }),
  new EnvSecretProvider(),            // fallback for local development
);
```

## Ref shape

`vault:<path-under-mount>[#<field>]` — e.g. `vault:apps/billing/prod#stripe_key`
reads `GET {url}/v1/secret/data/apps/billing/prod` and returns the
`stripe_key` field from the KV v2 response's `data.data`.

A bare path (`vault:apps/solo`, no `#field`) resolves only when the secret
holds exactly one field — anything else is ambiguous and resolves to
`undefined` rather than guessing which key the caller meant.

## Failure behavior

- a missing secret, a denied read, an unreachable Vault, or an ambiguous
  bare-path lookup all resolve to `undefined` — the same posture
  `FileSecretProvider` takes for a missing file, never a thrown error;
- reads are cached per ref with a TTL (default 60s, like
  `FileSecretProvider`) so a rotated secret still surfaces within a bounded
  window without a network round trip on every action;
- `fetchImpl` is injectable — tests run offline against canned responses.

## Not included

Token lifecycle (AppRole login, renewal, Kubernetes auth) is a deployment
concern. Supply a static `token`, or omit it and inject a valid
`Authorization`/`X-Vault-Token` header yourself via `headers` — a Vault
Agent sidecar or an externally renewed token both work behind that seam.
