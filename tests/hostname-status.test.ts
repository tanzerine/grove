import { describe, it, expect } from 'vitest';
import {
  buildSetupSteps,
  dnsPointsAtVercel,
  recordLabel,
  VERCEL_APEX_IP,
} from '../lib/hostname-status';

describe('recordLabel', () => {
  it('returns the subdomain label a registrar UI wants', () => {
    expect(recordLabel('blog.oveners.com')).toBe('blog');
    expect(recordLabel('news.acme.co.uk')).toBe('news');
  });
});

describe('dnsPointsAtVercel', () => {
  it('accepts the standard CNAME target, with or without a trailing dot', () => {
    expect(dnsPointsAtVercel('cname.vercel-dns.com')).toBe(true);
    expect(dnsPointsAtVercel('cname.vercel-dns.com.')).toBe(true);
    expect(dnsPointsAtVercel('CNAME.VERCEL-DNS.COM')).toBe(true);
  });
  it('accepts region-prefixed vercel-dns targets', () => {
    expect(dnsPointsAtVercel('cname-china.vercel-dns.com')).toBe(true);
  });
  it('accepts a flattened A record at any Vercel anycast address', () => {
    expect(dnsPointsAtVercel(null, [VERCEL_APEX_IP])).toBe(true);
    expect(dnsPointsAtVercel(undefined, ['1.2.3.4', VERCEL_APEX_IP])).toBe(true);
    // Regression: the recogniser knew only 76.76.21.21, which today matches
    // NOTHING Vercel answers with. Measured 2026-08-02 — trygroveai.com's own
    // apex is 216.198.79.1, and cname.vercel-dns.com resolves to 76.76.21.22
    // and 66.33.60.129. A correct A-record setup was reported as "no record
    // found yet" by the very checklist meant to confirm it.
    for (const ip of ['216.198.79.1', '76.76.21.22', '66.33.60.129']) {
      expect(dnsPointsAtVercel(null, [ip]), ip).toBe(true);
    }
  });
  it('tolerates whitespace around resolver output', () => {
    expect(dnsPointsAtVercel(null, [' 216.198.79.1 '])).toBe(true);
  });
  it('rejects anything else', () => {
    expect(dnsPointsAtVercel('ghs.googlehosted.com')).toBe(false);
    expect(dnsPointsAtVercel(null, ['203.0.113.10'])).toBe(false);
    expect(dnsPointsAtVercel(null, [])).toBe(false);
    expect(dnsPointsAtVercel(undefined, undefined)).toBe(false);
  });
});

describe('buildSetupSteps', () => {
  const base = { hostname: 'blog.acme.com' } as const;

  it('all green when attached, DNS points at Vercel, and the blog serves', () => {
    const { steps, allOk } = buildSetupSteps({
      ...base, attach: 'attached', cnameTarget: 'cname.vercel-dns.com.', serving: true,
    });
    expect(allOk).toBe(true);
    expect(steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(steps.every((s) => s.hint === undefined)).toBe(true);
  });

  it('a host that already serves grove counts as DNS-verified, whatever the records look like', () => {
    // The IP list will fall behind Vercel again. When it does, the checklist
    // must not tell a customer their DNS is missing while the blog they can
    // already load says otherwise — serving is the stronger proof.
    const { steps, allOk } = buildSetupSteps({
      ...base, attach: 'attached', aRecords: ['198.51.100.7'], serving: true,
    });
    expect(allOk).toBe(true);
    const dns = steps.find((s) => s.id === 'dns')!;
    expect(dns.ok).toBe(true);
    expect(dns.hint).toBeUndefined();
  });

  it('fresh setup: nothing done yet — every step pending with an actionable hint', () => {
    const { steps, allOk } = buildSetupSteps({ ...base, attach: 'not_attached', serving: false });
    expect(allOk).toBe(false);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.attach.ok).toBe(false);
    expect(byId.attach.hint).toContain('Save again');
    expect(byId.dns.ok).toBe(false);
    expect(byId.dns.hint).toContain('no record found');
    expect(byId.live.ok).toBe(false);
    expect(byId.live.hint).toContain('waiting on the DNS record');
  });

  it('DNS pointed at the wrong place names the current target', () => {
    const { steps } = buildSetupSteps({
      ...base, attach: 'attached', cnameTarget: 'ghs.googlehosted.com.', serving: false,
    });
    const dns = steps.find((s) => s.id === 'dns')!;
    expect(dns.ok).toBe(false);
    expect(dns.hint).toContain('ghs.googlehosted.com');
    expect(dns.hint).toContain('cname.vercel-dns.com');
  });

  it('DNS ok but not serving yet reads as certificate provisioning', () => {
    const { steps } = buildSetupSteps({
      ...base, attach: 'attached', cnameTarget: 'cname.vercel-dns.com', serving: false,
    });
    const live = steps.find((s) => s.id === 'live')!;
    expect(live.ok).toBe(false);
    expect(live.hint).toContain('provisioning');
  });

  it('skipped attach (no Vercel env) points at the manual Domains-tab fallback', () => {
    const { steps } = buildSetupSteps({ ...base, attach: 'skipped', serving: false });
    const attach = steps.find((s) => s.id === 'attach')!;
    expect(attach.ok).toBe(false);
    expect(attach.hint).toContain('Vercel project');
    expect(attach.hint).toContain('blog.acme.com');
  });

  it('attach errors surface the message', () => {
    const { steps } = buildSetupSteps({
      ...base, attach: 'error', attachMessage: 'vercel responded 500', serving: false,
    });
    expect(steps.find((s) => s.id === 'attach')!.hint).toBe('vercel responded 500');
  });
});
