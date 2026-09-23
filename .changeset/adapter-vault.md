---
"@naro/adapter-vault": minor
---

New package: `VaultSecretProvider`, a `SecretProvider` implementation for
HashiCorp Vault KV v2, resolving `vault:<path>[#<field>]` references —
the extension point `@naro/tools`'s `chainSecrets()` has named since it
was written. Closes the "no built-in secret backend" gap noted in
`docs/production-readiness.md` §2; cloud KMS remains a deployment
responsibility. TTL-cached reads (like `FileSecretProvider`), fail-open
to `undefined` rather than throwing on a missing/denied/unreachable
secret, and an injectable `fetch` for offline tests.
