import { describe, it, expect } from 'vitest';
import {
  isVercelDomainsConfigured,
  teamQuery,
  projectDomainsUrl,
  projectDomainUrl,
  normalizeChallenges,
  classifyDomainBody,
  errMessage,
  cnameHint,
} from '../lib/vercel/domains';

describe('isVercelDomainsConfigured', () => {
  it('requires both a token and a project id', () => {
    expect(isVercelDomainsConfigured({ token: 't', projectId: 'p' })).toBe(true);
    expect(isVercelDomainsConfigured({ token: 't' })).toBe(false);
    expect(isVercelDomainsConfigured({ projectId: 'p' })).toBe(false);
    expect(isVercelDomainsConfigured({})).toBe(false);
  });
  it('a team id alone is not enough', () => {
    expect(isVercelDomainsConfigured({ teamId: 'team_1' })).toBe(false);
  });
});

describe('URL builders', () => {
  it('omits the team query when no team is set', () => {
    expect(teamQuery(undefined)).toBe('');
    expect(projectDomainsUrl('prj_1')).toBe('https://api.vercel.com/v10/projects/prj_1/domains');
    expect(projectDomainUrl('prj_1', 'blog.acme.com')).toBe(
      'https://api.vercel.com/v9/projects/prj_1/domains/blog.acme.com',
    );
  });
  it('appends and encodes the team id when set', () => {
    expect(teamQuery('team a')).toBe('?teamId=team%20a');
    expect(projectDomainsUrl('prj_1', 'team_9')).toBe(
      'https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_9',
    );
    expect(projectDomainUrl('prj_1', 'blog.acme.com', 'team_9')).toBe(
      'https://api.vercel.com/v9/projects/prj_1/domains/blog.acme.com?teamId=team_9',
    );
  });
  it('encodes project name and hostname path segments', () => {
    expect(projectDomainUrl('my project', 'blog.acme.com')).toContain('/projects/my%20project/');
  });
});

describe('normalizeChallenges', () => {
  it('keeps well-formed challenges and drops malformed ones', () => {
    const out = normalizeChallenges([
      { type: 'CNAME', domain: 'blog.acme.com', value: 'cname.vercel-dns.com' },
      { type: 'TXT', domain: '_vercel.acme.com', value: 'abc', reason: 'pending' },
      { type: '', value: 'x' }, // no type
      { type: 'A', domain: 'acme.com' }, // no value
      'garbage',
      null,
    ]);
    expect(out).toEqual([
      { type: 'CNAME', domain: 'blog.acme.com', value: 'cname.vercel-dns.com', reason: undefined },
      { type: 'TXT', domain: '_vercel.acme.com', value: 'abc', reason: 'pending' },
    ]);
  });
  it('returns [] for non-array input', () => {
    expect(normalizeChallenges(undefined)).toEqual([]);
    expect(normalizeChallenges({})).toEqual([]);
  });
});

describe('classifyDomainBody', () => {
  it('reads verified + challenges from an add response', () => {
    const r = classifyDomainBody(
      { name: 'blog.acme.com', verified: false, verification: [{ type: 'CNAME', domain: 'blog.acme.com', value: 'cname.vercel-dns.com' }] },
      'attached',
    );
    expect(r).toEqual({
      ok: true,
      state: 'attached',
      verified: false,
      verification: [{ type: 'CNAME', domain: 'blog.acme.com', value: 'cname.vercel-dns.com', reason: undefined }],
    });
  });
  it('treats verified:true as verified and tolerates a missing verification array', () => {
    const r = classifyDomainBody({ name: 'blog.acme.com', verified: true }, 'already_attached');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toBe('already_attached');
      expect(r.verified).toBe(true);
      expect(r.verification).toEqual([]);
    }
  });
  it('only verified===true counts (a truthy non-true value is not verified)', () => {
    const r = classifyDomainBody({ verified: 'yes' }, 'attached');
    expect(r.ok && r.verified).toBe(false);
  });
});

describe('errMessage', () => {
  it('prefers the Vercel error message', () => {
    expect(errMessage({ error: { message: 'Domain is already in use' } }, 409)).toBe('Domain is already in use');
  });
  it('falls back to the status code', () => {
    expect(errMessage({}, 500)).toBe('vercel responded 500');
    expect(errMessage(null, 403)).toBe('vercel responded 403');
  });
});

describe('cnameHint', () => {
  it('uses the returned CNAME challenge when present', () => {
    const hint = cnameHint({
      ok: true, state: 'attached', verified: false,
      verification: [{ type: 'CNAME', domain: 'blog.acme.com', value: 'x.vercel-dns.com' }],
    });
    expect(hint).toEqual({ host: 'blog.acme.com', value: 'x.vercel-dns.com' });
  });
  it('falls back to the standard record when there is no CNAME challenge', () => {
    expect(cnameHint({ ok: true, state: 'attached', verified: true, verification: [] }))
      .toEqual({ host: 'blog', value: 'cname.vercel-dns.com' });
    expect(cnameHint({ ok: false, state: 'error', message: 'nope' }))
      .toEqual({ host: 'blog', value: 'cname.vercel-dns.com' });
  });
});
