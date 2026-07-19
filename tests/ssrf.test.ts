import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateIp, assertPublicHttpUrl, safeFetch } from '../lib/net/ssrf';

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

describe('safeFetch redirect handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a redirect hop that points at an internal address', async () => {
    // A public host that 302s Grove toward cloud metadata — the classic
    // guard bypass. safeFetch must re-validate the Location and refuse.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );
    await expect(safeFetch('https://8.8.8.8/start')).rejects.toThrow();
    // it fetched the first (public) hop but never the internal redirect target
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never connects to a literal private target', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(safeFetch('http://10.0.0.1/')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled(); // blocked before any socket opens
  });

  it('returns the response for a public 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const r = await safeFetch('https://8.8.8.8/');
    expect(r.status).toBe(200);
  });
});
