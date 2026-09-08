/**
 * Password hashing.
 *
 * scrypt from Node's own crypto is used rather than bcrypt or argon2 so the
 * platform gains a log-in without gaining a native dependency that has to
 * compile on every deploy target. The parameters below are the Node defaults
 * scaled to roughly 100ms per hash on a small serverless instance.
 *
 * Stored form is a versioned envelope, `s1:<salt>:<digest>`, both base64. The
 * prefix means a future change of algorithm or cost can re-hash on next
 * successful sign-in without a migration.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export { MIN_PASSWORD_LENGTH, passwordProblem } from './password-policy';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const VERSION = 's1';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// N=16384, r=8 needs 128 * N * r bytes ≈ 16MB; the default 32MB ceiling leaves
// no headroom, so it is raised explicitly rather than left to trip at runtime.
const PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const digest = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return `${VERSION}:${salt.toString('base64')}:${digest.toString('base64')}`;
}

/**
 * Constant-time verification. Returns false for anything malformed rather than
 * throwing, so a corrupted row cannot be told apart from a wrong password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== VERSION) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'base64');
    expected = Buffer.from(parts[2], 'base64');
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_LENGTH) return false;

  const actual = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return timingSafeEqual(actual, expected);
}
