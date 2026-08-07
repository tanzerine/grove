/**
 * The owner notification for a piece of feedback.
 *
 * Two things this email has to get right. It must carry the WHOLE message —
 * the owner reads mail on a phone, and a complaint that needs a login before it
 * can be read is a complaint that waits. And its subject has to be triageable
 * at a glance, because during a beta launch several of these arrive a day.
 */
import { describe, it, expect } from 'vitest';
import { composeFeedbackOwnerEmail, type FeedbackEmailInput } from '../lib/email/feedback';

const BASE: FeedbackEmailInput = {
  kind: 'shortcoming',
  email: 'tester@acme.com',
  plan: null,
  betaCode: 'GROVEBETA',
  rating: 3,
  headline: null,
  body: "The drafts read well but they don't sound like us yet.",
  area: 'brand_voice',
  severity: null,
  postsPublished: 7,
  consentPublish: false,
  displayName: null,
  displayRole: null,
  adminUrl: 'https://trygroveai.com/dashboard/admin/feedback',
};

describe('subject lines', () => {
  it('leads with what decides whether to open it now', () => {
    const blocker = composeFeedbackOwnerEmail({
      ...BASE, kind: 'complaint', severity: 'blocker', area: 'publishing',
    });
    expect(blocker.subject).toBe('BLOCKING complaint from tester@acme.com — Publishing & scheduling');

    const minor = composeFeedbackOwnerEmail({
      ...BASE, kind: 'complaint', severity: 'minor', area: 'publishing',
    });
    expect(minor.subject).toBe('Complaint from tester@acme.com — Publishing & scheduling');
  });

  it('reads as good news for a testimonial', () => {
    const s = composeFeedbackOwnerEmail({ ...BASE, kind: 'testimonial', rating: 5 }).subject;
    expect(s).toBe('Testimonial from tester@acme.com (5/5)');
  });

  it('never collapses the three kinds into one indistinguishable subject', () => {
    const subjects = (['testimonial', 'shortcoming', 'complaint'] as const).map(
      (kind) => composeFeedbackOwnerEmail({ ...BASE, kind }).subject,
    );
    expect(new Set(subjects).size).toBe(3);
  });

  it('survives an account with no email on it', () => {
    const s = composeFeedbackOwnerEmail({ ...BASE, email: null }).subject;
    expect(s).toContain('a customer');
    expect(s).not.toContain('null');
  });
});

describe('the body', () => {
  it('carries the whole message, not a nudge to go read it', () => {
    const { text, html } = composeFeedbackOwnerEmail(BASE);
    expect(text).toContain(BASE.body);
    expect(html).toContain('sound like us yet');
  });

  it('includes the context the customer never had to type', () => {
    const { text } = composeFeedbackOwnerEmail(BASE);
    expect(text).toContain('Sounding like us');   // area, resolved to its label
    expect(text).toContain('Beta (GROVEBETA)');   // who they are commercially
    expect(text).toContain('7');                  // posts published
    expect(text).toContain('3/5');                // rating
  });

  it('names the paid plan when there is no beta code', () => {
    const { text } = composeFeedbackOwnerEmail({ ...BASE, betaCode: null, plan: 'growth' });
    expect(text).toContain('Growth');
    const none = composeFeedbackOwnerEmail({ ...BASE, betaCode: null, plan: null });
    expect(none.text).toContain('No plan');
  });

  it('omits rows it has no answer for rather than printing a wall of dashes', () => {
    const bare = composeFeedbackOwnerEmail({
      ...BASE, area: null, severity: null, rating: null, postsPublished: null,
    });
    expect(bare.text).not.toContain('Severity');
    expect(bare.text).not.toContain('Rating');
    expect(bare.text).not.toContain('Posts published');
  });

  it('links to the admin view without embedding an action', () => {
    // Nothing a mail scanner can prefetch may publish a quote or close a
    // ticket — same rule as the refund email.
    const { html, text } = composeFeedbackOwnerEmail(BASE);
    expect(text).toContain(BASE.adminUrl);
    expect(html).toContain(BASE.adminUrl);
    expect(html).not.toMatch(/publish=true|action=/);
  });

  it('offers a direct reply path when we know where to send it', () => {
    expect(composeFeedbackOwnerEmail(BASE).html).toContain('mailto:tester@acme.com');
    expect(composeFeedbackOwnerEmail({ ...BASE, email: null }).html).not.toContain('mailto:');
  });
});

describe('testimonial consent', () => {
  it('states plainly whether the quote may be used, and how to credit it', () => {
    const yes = composeFeedbackOwnerEmail({
      ...BASE, kind: 'testimonial', consentPublish: true,
      displayName: 'Ada Lovelace', displayRole: 'Founder, Acme',
    });
    expect(yes.text).toContain('Yes — as Ada Lovelace, Founder, Acme');

    const no = composeFeedbackOwnerEmail({ ...BASE, kind: 'testimonial', consentPublish: false });
    expect(no.text).toContain('No — private feedback only');
  });

  it('never raises consent on a kind that cannot be published', () => {
    // A complaint is not a quote. Asking "may we use this?" next to one is how
    // an angry message gets treated as marketing copy.
    const c = composeFeedbackOwnerEmail({ ...BASE, kind: 'complaint', consentPublish: true });
    expect(c.text).not.toContain('May we quote them');
  });
});

describe('escaping', () => {
  it('neutralises markup from the customer everywhere it lands', () => {
    const nasty = composeFeedbackOwnerEmail({
      ...BASE,
      headline: '<img src=x onerror=alert(1)>',
      body: '</div><script>alert("xss")</script>',
      displayName: '"><b>bold',
    });
    expect(nasty.html).not.toContain('<script>');
    expect(nasty.html).not.toContain('<img src=x');
    expect(nasty.html).toContain('&lt;script&gt;');
    // The plain-text part is not markup, so it keeps the original — that's the
    // owner seeing exactly what was typed.
    expect(nasty.text).toContain('<script>');
  });
});
