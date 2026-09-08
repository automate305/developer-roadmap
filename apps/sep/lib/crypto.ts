import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * Encryption for mailbox credentials at rest.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a tampered ciphertext
 * fails to decrypt rather than yielding garbage. The stored envelope is
 *
 *   v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>
 *
 * The version prefix is what makes key rotation possible later, and what lets
 * `decryptSecret` recognise a legacy plaintext value and pass it through
 * unchanged so an existing install keeps working until it is migrated.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for.

/** True when the value is one of our envelopes rather than raw plaintext. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

function key(): Buffer {
  const raw = env.credentialKey;

  // Accept either base64 or hex, so `openssl rand` output works in either form.
  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (decoded.length !== 32) {
    throw new Error(
      'CREDENTIAL_KEY must decode to 32 bytes. Generate one with: openssl rand -base64 32',
    );
  }
  return decoded;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

/**
 * Decrypts an envelope. A value that is not an envelope is returned as-is:
 * credentials stored before this existed stay usable until migrated.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const [, ivPart, tagPart, dataPart] = stored.split(':');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Stored credential is malformed and cannot be decrypted.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, or the ciphertext was altered. Never fall back to raw bytes.
    throw new Error(
      'Could not decrypt a stored credential. CREDENTIAL_KEY may have changed since it was saved.',
    );
  }
}

/** Encrypts only when a value is present, for optional fields like IMAP. */
export function encryptOptionalSecret(plaintext: string | null | undefined): string | null {
  const trimmed = plaintext?.trim();
  return trimmed ? encryptSecret(trimmed) : null;
}

export function decryptOptionalSecret(stored: string | null | undefined): string | null {
  return stored ? decryptSecret(stored) : null;
}

/** Constant-time equality, for comparing secrets without leaking length timing. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
