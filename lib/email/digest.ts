/**
 * Compose the weekly digest email from a BriefStats.
 *
 * Pure: takes the same stats the dashboard home renders plus a base URL, and
 * returns { subject, html, text }. No DB, no env, no network — so the words
 * and layout are unit-testable (see tests/digest-email.test.ts). The cron route
 * (app/api/cron/weekly-digest) gathers the stats and hands them here.
 *
 * The body mirrors the on-dashboard brief: the plain-English sentences, a row
 * of stat chips (reads w/ delta, site clicks, published), the top post, and a
 * single CTA to the dashboard — swapped to the reviews queue when drafts wait.
 */
import { composeBrief, nextAction, type BriefStats } from '../agent-brief';

export type DigestEmail = { subject: string; html: string; text: string };

const MOSS = '#59945e';
const INK = '#1c2620';
const MUTE = '#6b7770';

/** Percent change of this week's reads vs last week, or null when not meaningful. */
export function readsDelta(s: BriefStats): { pct: number; dir: 'up' | 'down' | 'flat' } | null {
  if (s.readsLastWeek <= 0 || s.readsThisWeek <= 0) return null;
  const pct = Math.round(((s.readsThisWeek - s.readsLastWeek) / s.readsLastWeek) * 100);
  if (pct >= 5) return { pct, dir: 'up' };
  if (pct <= -5) return { pct: Math.abs(pct), dir: 'down' };
  return { pct: 0, dir: 'flat' };
}

type Chip = { label: string; value: string; sub?: string };

/** The stat chips, in display order. Reused by both html and text renders. */
export function digestChips(s: BriefStats): Chip[] {
  const d = readsDelta(s);
  const readsSub = d
    ? d.dir === 'flat'
      ? 'steady vs last week'
      : `${d.dir === 'up' ? '▲' : '▼'} ${d.pct}% vs last week`
    : s.readsThisWeek > 0
      ? 'your first readers'
      : undefined;

  return [
    { label: 'Reads this week', value: s.readsThisWeek.toLocaleString(), sub: readsSub },
    { label: 'Clicks to your site', value: s.conversionsThisWeek.toLocaleString() },
    { label: 'Published this week', value: s.publishedThisWeek.toLocaleString() },
  ];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, '') + path;
}

export function composeDigestEmail(s: BriefStats, baseUrl: string): DigestEmail {
  const sentences = composeBrief(s);
  const chips = digestChips(s);
  const action = nextAction(s); // { label, href } | null — reviews queue when drafts wait

  const dashUrl = joinUrl(baseUrl, '/dashboard');
  const ctaHref = action ? joinUrl(baseUrl, action.href) : dashUrl;
  const ctaLabel = action ? 'Review waiting drafts' : 'Open your dashboard';

  // ── subject ────────────────────────────────────────────────
  const d = readsDelta(s);
  let subject: string;
  if (s.totalPublished === 0) {
    subject = `Your Grove agent is getting started on ${s.hostname}`;
  } else if (s.inReview > 0) {
    subject = `${s.inReview} draft${s.inReview === 1 ? '' : 's'} waiting + your weekly Grove report`;
  } else if (s.readsThisWeek > 0 && d && d.dir !== 'flat') {
    subject = `${s.hostname}: reads ${d.dir} ${d.pct}% this week`;
  } else {
    subject = `Your weekly Grove report for ${s.hostname}`;
  }

  // ── text ───────────────────────────────────────────────────
  const textLines: string[] = [
    `Your weekly Grove report — ${s.hostname}`,
    '',
    ...sentences.map((l) => `• ${l}`),
    '',
    ...chips.map((c) => `${c.label}: ${c.value}${c.sub ? ` (${c.sub})` : ''}`),
  ];
  if (s.topPost) textLines.push('', `Top post: “${s.topPost.title}” — ${s.topPost.views} reads`);
  textLines.push('', `${ctaLabel}: ${ctaHref}`);
  textLines.push('', `Don't want these? Turn off the weekly digest in your dashboard settings.`);
  const text = textLines.join('\n');

  // ── html ───────────────────────────────────────────────────
  const chipHtml = chips
    .map(
      (c) => `
      <td style="padding:0 6px;" valign="top">
        <div style="background:#f3f6f3;border:1px solid #e2e9e3;border-radius:12px;padding:14px 16px;">
          <div style="font-size:24px;font-weight:700;color:${INK};line-height:1.1;font-family:Georgia,serif;">${esc(c.value)}</div>
          <div style="font-size:12px;color:${MUTE};margin-top:4px;">${esc(c.label)}</div>
          ${c.sub ? `<div style="font-size:12px;color:${MOSS};margin-top:2px;">${esc(c.sub)}</div>` : ''}
        </div>
      </td>`,
    )
    .join('');

  const sentencesHtml = sentences
    .map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:${INK};">${esc(l)}</p>`)
    .join('');

  const topPostHtml = s.topPost
    ? `<div style="margin:20px 0 0;padding:14px 16px;background:#fbfaf6;border-left:3px solid ${MOSS};border-radius:6px;">
         <div style="font-size:12px;color:${MUTE};text-transform:uppercase;letter-spacing:0.04em;">Top post this week</div>
         <div style="font-size:15px;color:${INK};margin-top:4px;">“${esc(s.topPost.title)}” — ${s.topPost.views} reads</div>
       </div>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef1ee;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ee;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e9e3;">
          <tr><td style="padding:24px 28px 8px;">
            <div style="font-family:Georgia,serif;font-size:13px;color:${MOSS};letter-spacing:0.06em;text-transform:uppercase;">Grove · weekly report</div>
            <h1 style="margin:6px 0 0;font-size:22px;color:${INK};font-family:Georgia,serif;">${esc(s.hostname)}</h1>
          </td></tr>
          <tr><td style="padding:16px 28px 4px;">${sentencesHtml}</td></tr>
          <tr><td style="padding:8px 22px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${chipHtml}</tr></table>
          </td></tr>
          <tr><td style="padding:4px 28px 0;">${topPostHtml}</td></tr>
          <tr><td style="padding:24px 28px 28px;" align="center">
            <a href="${esc(ctaHref)}" style="display:inline-block;background:${MOSS};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:10px;">${esc(ctaLabel)} →</a>
          </td></tr>
          <tr><td style="padding:0 28px 24px;border-top:1px solid #eef1ee;">
            <p style="margin:16px 0 0;font-size:12px;color:${MUTE};line-height:1.5;">
              You're getting this because Grove runs your content on ${esc(s.hostname)}.
              <a href="${esc(dashUrl)}/settings" style="color:${MUTE};">Turn off the weekly digest</a> anytime.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
