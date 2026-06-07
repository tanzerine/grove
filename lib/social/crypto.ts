/**
 * Token encryption for stored OAuth credentials.
 *
 * Third-party access/refresh tokens are sensitive — leaking them lets an
 * attacker post as the customer. We encrypt with AES-256-GCM using
 * SOCIAL_TOKEN_KEY (a 32-byte key, hex or base64).
 *
 * If the key is unset we fall back to a clearly-marked "plain:" prefix so
 * local dev still works — but production MUST set SOCIAL_TOKEN_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function key(): Buffer | null {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export function encryptToken(plaintext: string): string {
  const k = key();
  if (!k) {
    console.warn('[social] SOCIAL_TOKEN_KEY unset — storing token unencrypted. Set it in production.');
    return 'plain:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // gcm:<iv>:<tag>:<ciphertext>  (all base64)
  return `gcm:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptToken(stored: string): string {
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  if (stored.startsWith('gcm:')) {
    const k = key();
    if (!k) throw new Error('SOCIAL_TOKEN_KEY required to decrypt stored token');
    const [, ivB64, tagB64, dataB64] = stored.split(':');
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
  // legacy / unknown — assume plaintext
  return stored;
}
