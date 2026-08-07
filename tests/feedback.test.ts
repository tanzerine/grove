/**
 * Customer→owner feedback: the shared vocabulary, the triage order, and the
 * one rule with real consequences outside the app — a quote only leaves the
 * building if its author said it could.
 */
import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_IDS,
  FEEDBACK_AREAS,
  FEEDBACK_AREA_CODES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_CODES,
  FEEDBACK_LIMITS,
  isFeedbackKind,
  isFeedbackStatus,
  isOpen,
  kindConfig,
  kindLabel,
  areaLabel,
  severityLabel,
  statusLabel,
  triageRank,
  toTestimonial,
} from '../lib/feedback';

describe('the three doors', () => {
  it('covers exactly the three the owner has to act on differently', () => {
    // publish it / plan it / answer it — the split is by what the OWNER does
    // next, which is why criticism is two doors and not one.
    expect(FEEDBACK_KIND_IDS).toEqual(['testimonial', 'shortcoming', 'complaint']);
  });

  it('gives every kind its own prompt, placeholder and confirmation', () => {
    // A shared "tell us more" placeholder across all three is how a feedback
    // form ends up collecting nothing usable.
    const prompts = new Set(FEEDBACK_KINDS.map((k) => k.prompt));
    const placeholders = new Set(FEEDBACK_KINDS.map((k) => k.placeholder));
    const thanks = new Set(FEEDBACK_KINDS.map((k) => k.thanks));
    expect(prompts.size).toBe(3);
    expect(placeholders.size).toBe(3);
    expect(thanks.size).toBe(3);
    for (const k of FEEDBACK_KINDS) {
      expect(k.blurb.length).toBeGreaterThan(0);
      expect(k.cta.length).toBeGreaterThan(0);
      expect(k.thanksBody.length).toBeGreaterThan(0);
    }
  });

  it('validates kinds and never resolves an unknown one to a real config', () => {
    expect(isFeedbackKind('complaint')).toBe(true);
    expect(isFeedbackKind('praise')).toBe(false);
    expect(isFeedbackKind(null)).toBe(false);
    expect(kindLabel('complaint')).toBe('Complaint');
    expect(kindLabel('nonsense')).toBe('—');
    expect(kindConfig('testimonial').kind).toBe('testimonial');
  });
});

describe('vocabulary', () => {
  it('labels every code and degrades to the raw code, never to a crash', () => {
    for (const a of FEEDBACK_AREAS) expect(areaLabel(a.code)).toBe(a.label);
    for (const s of FEEDBACK_SEVERITIES) expect(severityLabel(s.code)).toBe(s.label);
    for (const s of FEEDBACK_STATUSES) expect(statusLabel(s.code)).toBe(s.label);
    expect(areaLabel('made_up')).toBe('made_up');
    expect(areaLabel(null)).toBe('—');
    expect(severityLabel(undefined)).toBe('—');
  });

  it('keeps the code lists in step with their tables', () => {
    expect(FEEDBACK_AREA_CODES).toHaveLength(FEEDBACK_AREAS.length);
    expect(new Set(FEEDBACK_AREA_CODES).size).toBe(FEEDBACK_AREAS.length);
    expect(new Set(FEEDBACK_STATUS_CODES).size).toBe(FEEDBACK_STATUSES.length);
  });

  it('knows which statuses still owe the customer something', () => {
    expect(isOpen('new')).toBe(true);
    expect(isOpen('acknowledged')).toBe(true);
    expect(isOpen('in_progress')).toBe(true);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('wont_fix')).toBe(false);
    expect(isOpen('dismissed')).toBe(false);
    // An unset status is a brand new row, which is the most open thing there is.
    expect(isOpen(null)).toBe(true);
    expect(isFeedbackStatus('resolved')).toBe(true);
    expect(isFeedbackStatus('escalated')).toBe(false);
  });
});

describe('triage order', () => {
  const open = (kind: string, severity?: string) => ({ kind, severity, status: 'new' });

  it('puts a blocking complaint above everything else', () => {
    const ranked = [
      open('testimonial'),
      open('complaint', 'minor'),
      open('shortcoming'),
      open('complaint', 'blocker'),
      open('complaint', 'major'),
    ]
      .slice()
      .sort((a, b) => triageRank(a) - triageRank(b));

    expect(ranked.map((r) => [r.kind, r.severity])).toEqual([
      ['complaint', 'blocker'],
      ['complaint', 'major'],
      ['complaint', 'minor'],
      ['shortcoming', undefined],
      ['testimonial', undefined],
    ]);
  });

  it('sinks anything already dealt with below everything open', () => {
    // Including a resolved blocker, which would otherwise outrank a live one.
    const resolvedBlocker = { kind: 'complaint', severity: 'blocker', status: 'resolved' };
    expect(triageRank(resolvedBlocker)).toBeGreaterThan(triageRank(open('testimonial')));
  });
});

describe('publishing a testimonial', () => {
  it('prefers the one-line version, and falls back to what they wrote', () => {
    expect(toTestimonial({ headline: 'Three posts a week.', body: 'Long version…' }).quote)
      .toBe('Three posts a week.');
    expect(toTestimonial({ headline: '   ', body: 'Long version…' }).quote).toBe('Long version…');
  });

  it('never renders an unattributed quote', () => {
    // A quote with no name reads as invented, which is the exact impression
    // real testimonials exist to avoid.
    const t = toTestimonial({ body: 'It works.', display_name: null });
    expect(t.name).toBe('A Grove customer');
    // Initials come from the fallback name like any other, so the avatar chip
    // is never blank.
    expect(t.initials).toBe('AG');
  });

  it('derives initials from at most two names', () => {
    expect(toTestimonial({ body: 'x', display_name: 'Ada Lovelace' }).initials).toBe('AL');
    expect(toTestimonial({ body: 'x', display_name: 'ada' }).initials).toBe('A');
    expect(toTestimonial({ body: 'x', display_name: 'Jean Luc Picard' }).initials).toBe('JL');
    // Non-Latin names must still produce something rather than an empty chip.
    expect(toTestimonial({ body: 'x', display_name: '이태윤' }).initials).toBe('이');
  });

  it('refuses to put a non-http scheme in an href', () => {
    // A stored `javascript:` value must never reach the landing page's link.
    expect(toTestimonial({ body: 'x', display_url: 'javascript:alert(1)' }).url).toBeNull();
    expect(toTestimonial({ body: 'x', display_url: 'data:text/html,<script>' }).url).toBeNull();
    expect(toTestimonial({ body: 'x', display_url: 'not a url' }).url).toBeNull();
    expect(toTestimonial({ body: 'x', display_url: '  ' }).url).toBeNull();
    expect(toTestimonial({ body: 'x', display_url: 'https://acme.com' }).url).toBe('https://acme.com/');
  });

  it('only carries a rating through when it is one we asked for', () => {
    expect(toTestimonial({ body: 'x', rating: 5 }).rating).toBe(5);
    expect(toTestimonial({ body: 'x', rating: 0 }).rating).toBeNull();
    expect(toTestimonial({ body: 'x', rating: 9 }).rating).toBeNull();
    expect(toTestimonial({ body: 'x' }).rating).toBeNull();
  });
});

describe('field limits', () => {
  it('are shared, so the form can never accept what the API will reject', () => {
    // The failure this prevents: a customer types 4,000 characters into a box
    // the server caps lower, and loses the message they took trouble over.
    expect(FEEDBACK_LIMITS.body).toBeGreaterThan(FEEDBACK_LIMITS.headline);
    for (const v of Object.values(FEEDBACK_LIMITS)) expect(v).toBeGreaterThan(0);
  });
});
