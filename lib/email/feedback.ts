/**
 * Compose the owner notification for a piece of customer feedback. Pure: no
 * DB, no env, no network — so the copy is unit-testable, exactly like
 * lib/email/refund.ts, which this deliberately mirrors.
 *
 * The email carries the FULL message, not a "you have new feedback" nudge. The
 * owner reads mail on a phone; a complaint that requires a login before it can
 * even be read is a complaint that waits. The deep link is for acting on it —
 * replying, publishing, triaging — not for finding out what it says.
 *
 * Like the refund email it contains no action that changes state, so a link
 * prefetched by a mail scanner can't publish a testimonial or close a ticket.
 */
import { areaLabel, kindLabel, severityLabel, type FeedbackKind } from '../feedback';

export type FeedbackEmailInput = {
  kind: FeedbackKind;
  email: string | null;
  plan: string | null;
  betaCode: string | null;
  rating: number | null;
  headline: string | null;
  body: string;
  area: string | null;
  severity: string | null;
  postsPublished: number | null;
  consentPublish: boolean;
  displayName: string | null;
  displayRole: string | null;
  adminUrl: string;
};

export type ComposedEmail = { subject: string; html: string; text: string };

const INK = '#1c2620';
const MUTE = '#6b7770';
const MOSS = '#59945e';
const RED = '#b4483c';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Subject lines lead with the thing that decides whether to open it now.
 *
 * A blocking complaint says so in the first three words; a testimonial reads
 * as good news. Flat "New feedback" subjects across all three kinds would make
 * the inbox useless the moment there is more than one a day — which, for a
 * beta launch, is the expected case rather than the optimistic one.
 */
function subjectFor(i: FeedbackEmailInput): string {
  const who = i.email ?? 'a customer';
  if (i.kind === 'complaint') {
    const urgent = i.severity === 'blocker' ? 'BLOCKING complaint' : 'Complaint';
    return `${urgent} from ${who}${i.area ? ` — ${areaLabel(i.area)}` : ''}`;
  }
  if (i.kind === 'testimonial') {
    return `Testimonial from ${who}${i.rating ? ` (${i.rating}/5)` : ''}`;
  }
  return `Beta feedback from ${who}${i.area ? ` — ${areaLabel(i.area)}` : ''}`;
}

function leadFor(kind: FeedbackKind): string {
  if (kind === 'complaint') return 'A customer has filed a complaint and is expecting a reply from you.';
  if (kind === 'testimonial') return 'A customer wrote something good about Grove.';
  return 'A customer told us what fell short. This is the beta doing its job.';
}

function ctaFor(kind: FeedbackKind): string {
  if (kind === 'complaint') return 'Open & reply';
  if (kind === 'testimonial') return 'Review & publish';
  return 'Open in feedback inbox';
}

export function composeFeedbackOwnerEmail(i: FeedbackEmailInput): ComposedEmail {
  const accent = i.kind === 'complaint' ? RED : MOSS;

  // Context rows, minus anything we don't actually know — a table half full of
  // em-dashes buries the three facts that matter.
  const rows: [string, string][] = [
    ['From', i.email ?? '—'],
    ['Type', kindLabel(i.kind)],
  ];
  if (i.area) rows.push(['Area', areaLabel(i.area)]);
  if (i.severity) rows.push(['Severity', severityLabel(i.severity)]);
  if (typeof i.rating === 'number') rows.push(['Rating', `${i.rating}/5`]);
  rows.push(['Account', accountLine(i)]);
  if (typeof i.postsPublished === 'number') {
    rows.push(['Posts published', String(i.postsPublished)]);
  }
  if (i.kind === 'testimonial') {
    rows.push([
      'May we quote them',
      i.consentPublish
        ? `Yes — as ${[i.displayName, i.displayRole].filter(Boolean).join(', ') || 'unnamed'}`
        : 'No — private feedback only',
    ]);
  }

  const headline = i.headline?.trim();
  const body = i.body.trim();

  const text = [
    leadFor(i.kind),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(headline ? [headline, ''] : []),
    body,
    '',
    ctaFor(i.kind) + ':',
    i.adminUrl,
  ].join('\n');

  const rowsHtml = rows
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:${MUTE};white-space:nowrap;vertical-align:top;">${esc(k)}</td>
        <td style="padding:8px 12px;font-size:14px;color:${INK};">${esc(v)}</td>
      </tr>`,
    )
    .join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="font-size:18px;color:${INK};margin:0 0 4px;">${esc(kindLabel(i.kind))}</h2>
    <p style="font-size:14px;color:${MUTE};margin:0 0 16px;">${esc(leadFor(i.kind))}</p>
    <table style="width:100%;border-collapse:collapse;background:#f7f9f7;border:1px solid #e2e9e3;border-radius:10px;overflow:hidden;">
      ${rowsHtml}
    </table>
    <div style="margin:18px 0 0;padding:16px 18px;border-left:3px solid ${accent};background:#fbfcfb;">
      ${headline ? `<div style="font-size:15px;font-weight:600;color:${INK};margin:0 0 8px;">${esc(headline)}</div>` : ''}
      <div style="font-size:14.5px;color:${INK};line-height:1.65;white-space:pre-wrap;">${esc(body)}</div>
    </div>
    <p style="margin:18px 0 0;">
      <a href="${esc(i.adminUrl)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:9px;">
        ${esc(ctaFor(i.kind))}
      </a>
    </p>
    ${
      i.email
        ? `<p style="font-size:12px;color:${MUTE};margin:14px 0 0;">Reply to them directly at
             <a href="mailto:${esc(i.email)}" style="color:${MOSS};">${esc(i.email)}</a>.</p>`
        : ''
    }
  </div>`;

  return { subject: subjectFor(i), html, text };
}

/** "Starter" / "Beta (GROVEBETA)" / "No plan" — who is this, commercially. */
function accountLine(i: FeedbackEmailInput): string {
  if (i.betaCode) return `Beta (${i.betaCode})`;
  if (i.plan) return i.plan.charAt(0).toUpperCase() + i.plan.slice(1);
  return 'No plan';
}
