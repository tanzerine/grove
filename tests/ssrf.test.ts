import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicHttpUrl } from '../lib/net/ssrf';

describe('isPrivateIp', () => {
  it('blocks loopback, RFC1918, link-local/metadata, CGNAT', () => {
    for (const ip of [
      '127.0.0.1', '10.0.0.5', '172.16.3.4', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('blocks IPv6 loopback, ULA, link-local, and mapped v4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes and literal private IPs', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicHttpUrl('https://127.0.0.1')).rejects.toThrow();
    await expect(assertPublicHttpUrl('https://localhost')).rejects.toThrow();
  });
});
