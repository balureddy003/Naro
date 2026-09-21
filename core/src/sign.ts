import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Journal sealing — the tamper-*detection* upgrade for the hash chain.
 *
 * The chain alone is tamper-evident: rewriting it is detectable only if a
 * copy of the true head survived elsewhere. A seal signs the head hash with
 * an Ed25519 key, so anyone holding the public key can prove the journal
 * ends exactly where the signer left it — a rewritten or extended chain
 * fails signature verification.
 *
 * Honest scope: sealing proves integrity and origin of the head *at seal
 * time*. It does not prove the events were true — only that they are the
 * events the sealing key-holder committed to. Key custody is deployment-
 * owned (KMS/HSM, not a string in the repo).
 */
export const SEAL_ALGORITHM = 'ed25519' as const;

export interface SealKeypair {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

/** Generate an Ed25519 keypair in PEM form. */
export function generateSealKeypair(): SealKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Sign a chain head hash. Returns the base64 signature. */
export function signHead(head: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(head, 'utf8'), key).toString('base64');
}

/** Derive the public key PEM from a private key PEM. */
export function publicKeyOf(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' });
}

/** Verify a head signature against a public key PEM. */
export function verifySeal(head: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(head, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
