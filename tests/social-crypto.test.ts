import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptToken, decryptToken } from '../lib/social/crypto';

const KEY = 'a'.repeat(64); // 32 bytes hex

describe('token crypto', () => {
  const orig = process.env.SOCIAL_TOKEN_KEY;
  afterEach(() => { process.env.SOCIAL_TOKEN_KEY = orig; });

  describe('with a key', () => {
    beforeEach(() => { process.env.SOCIAL_TOKEN_KEY = KEY; });

    it('roundtrips and does not store plaintext', () => {
      const secret = 'super-secret-access-token-xyz';
      const enc = encryptToken(secret);
      expect(enc.startsWith('gcm:')).toBe(true);
      expect(enc).not.toContain(secret);
      expect(decryptToken(enc)).toBe(secret);
    });

    it('produces a different ciphertext each time (random IV)', () => {
      expect(encryptToken('same')).not.toBe(encryptToken('same'));
    });
  });

  describe('without a key (dev fallback)', () => {
    beforeEach(() => { delete process.env.SOCIAL_TOKEN_KEY; });

    it('roundtrips via the marked plain fallback', () => {
      const enc = encryptToken('tok');
      expect(enc.startsWith('plain:')).toBe(true);
      expect(decryptToken(enc)).toBe('tok');
    });
  });
});
