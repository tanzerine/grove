import { describe, it, expect } from 'vitest';
import {
  EVENT_NAMES,
  ONBOARDING_STEPS,
  isEventName,
  onboardingStepNumber,
  sanitizeProps,
} from '../lib/analytics/events';

describe('event catalogue', () => {
  it('exposes every declared event name', () => {
    // A spot-check across the funnel rather than a brittle full-list assertion:
    // adding an event should not fail this test, but losing one should.
    for (const name of [
      'signed_up',
      'domain_submitted',
      'post_generation_started',
      'post_generation_succeeded',
      'post_generation_failed',
      'checkout_started',
      'quota_exhausted',
      'rate_limited',
    ]) {
      expect(EVENT_NAMES).toContain(name);
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it('names every event in lowercase snake_case', () => {
    // The naming rule is what makes PostHog's prefix grouping work; a stray
    // camelCase event would sort somewhere nobody looks.
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it('recognises known names and rejects typos', () => {
    expect(isEventName('post_approved')).toBe(true);
    expect(isEventName('post_aproved')).toBe(false);
    expect(isEventName('')).toBe(false);
  });

  it('does not treat inherited Object properties as events', () => {
    // isEventName backs runtime checks, so prototype keys must not pass.
    expect(isEventName('toString')).toBe(false);
    expect(isEventName('constructor')).toBe(false);
  });
});

describe('onboardingStepNumber', () => {
  it('numbers the steps from 1 in flow order', () => {
    expect(onboardingStepNumber('domain')).toBe(1);
    expect(onboardingStepNumber('verify')).toBe(2);
    expect(onboardingStepNumber('about')).toBe(3);
    expect(onboardingStepNumber('intent')).toBe(4);
  });

  it('covers every step in ONBOARDING_STEPS', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(onboardingStepNumber(step)).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeProps', () => {
  it('drops anything that looks like a credential or personal data', () => {
    const out = sanitizeProps({
      post_id: 'p1',
      email: 'someone@example.com',
      gsc_refresh_token: 'tok',
      client_secret: 's',
      password: 'p',
      api_key: 'k',
      authorization: 'Bearer x',
    });
    expect(out).toEqual({ post_id: 'p1' });
  });

  it('drops article bodies and prompts, which are never aggregatable', () => {
    const out = sanitizeProps({ domain_id: 'd1', body_md: '# huge article', prompt: 'write me…' });
    expect(out).toEqual({ domain_id: 'd1' });
  });

  it('matches forbidden keys case-insensitively and as substrings', () => {
    const out = sanitizeProps({ userEmail: 'a@b.c', API_KEY: 'x', ok: 1 });
    expect(out).toEqual({ ok: 1 });
  });

  it('drops undefined but keeps null, false and zero', () => {
    // These three are all meaningful signal — a manager score of 0, an
    // unscored draft, a failed verification — and must survive.
    const out = sanitizeProps({ a: undefined, score: 0, ok: false, action: null });
    expect(out).toEqual({ score: 0, ok: false, action: null });
  });

  it('leaves ordinary properties untouched', () => {
    const props = { post_id: 'p1', duration_ms: 1200, mode: 'queue' };
    expect(sanitizeProps(props)).toEqual(props);
  });
});
