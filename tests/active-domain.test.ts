/**
 * The site switcher must decide which site every surface is talking about.
 *
 * THE BUG THIS PINS. /api/domains/me picked "the primary verified domain" with
 * `order('verified_at', desc).limit(1)` and never read the switcher cookie. On
 * a multi-site account that made /onboarding/intent show the SAME answers under
 * every site, and — worse — "Save and continue" POSTed to that domain's
 * interview, which rebuilds its plan with `replaceActive`. The owner of two
 * sites edited one and silently re-planned the other, with nothing on screen to
 * say so. It reads as "editing is shared between my sites".
 *
 * pickActive is the rule; these cases are the contract every consumer relies on.
 */
import { describe, it, expect } from 'vitest';
import { pickActive } from '../lib/active-domain';

const OVENERS = { id: 'oveners', hostname: 'www.oveners.com', verified_at: '2026-06-02T10:24:09Z' };
const GROVE = { id: 'grove', hostname: 'trygroveai.com', verified_at: '2026-07-26T06:19:45Z' };
const UNVERIFIED = { id: 'draft', hostname: 'new.example', verified_at: null };

describe('pickActive', () => {
  it('honours the cookie over recency', () => {
    // The exact production shape: grove is verified LATER, so every
    // "most recently verified" query returns it. Selecting oveners has to win.
    const picked = pickActive([OVENERS, GROVE], 'oveners');
    expect(picked?.id).toBe('oveners');
  });

  it('picks either site depending only on the cookie', () => {
    // Same input, different selection — the property the old query could not
    // express, because it had no input from the switcher at all.
    expect(pickActive([OVENERS, GROVE], 'grove')?.id).toBe('grove');
    expect(pickActive([OVENERS, GROVE], 'oveners')?.id).toBe('oveners');
  });

  it('falls back to a verified site when no cookie is set', () => {
    expect(pickActive([UNVERIFIED, OVENERS], undefined)?.id).toBe('oveners');
  });

  it('ignores a stale or forged cookie rather than returning nothing', () => {
    // RLS already limits rows to the user's own; an id that isn't among them
    // must degrade to the default, never to null or someone else's site.
    expect(pickActive([OVENERS, GROVE], 'not-a-real-id')?.id).toBe('oveners');
  });

  it('falls back to the first row when nothing is verified', () => {
    expect(pickActive([UNVERIFIED], undefined)?.id).toBe('draft');
  });

  it('returns null only when the user has no sites', () => {
    expect(pickActive([], 'anything')).toBeNull();
  });
});
