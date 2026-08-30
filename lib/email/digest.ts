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
import { createT, intlLocale, type T, type UiLocale } from '../i18n';

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
export function digestChips(s: BriefStats, t: T = createT('en')): Chip[] {
  const d = readsDelta(s);
  const readsSub = d
    ? d.dir === 'flat'
      ? t('steady vs last week')
      : d.dir === 'up'
        ? t('▲ {pct}% vs last week', { pct: d.pct })
        : t('▼ {pct}% vs last week', { pct: d.pct })
    : s.readsThisWeek > 0
      ? t('your first readers')
      : undefined;

  const n = (v: number) => v.toLocaleString(intlLocale(t.locale));
  return [
    { label: t('Reads this week'), value: n(s.readsThisWeek), sub: readsSub },
    { label: t('Clicks to your site'), value: n(s.conversionsThisWeek) },
    { label: t('Published this week'), value: n(s.publishedThisWeek) },
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

export function composeDigestEmail(s: BriefStats, baseUrl: string, locale: UiLocale = 'en'): DigestEmail {
  // The owner's UI language, not the blog's publication language: this is grove
  // talking to the person, the same voice as the dashboard they'll click into.
  const t = createT(locale);
  const sentences = composeBrief(s, t);
  const chips = digestChips(s, t);
  const action = nextAction(s, t); // { label, href } | null — reviews queue when drafts wait

  const dashUrl = joinUrl(baseUrl, '/dashboard');
  const ctaHref = action ? joinUrl(baseUrl, action.href) : dashUrl;
  const ctaLabel = action ? t('Review waiting drafts') : t('Open your dashboard');

  // ── subject ────────────────────────────────────────────────
  const d = readsDelta(s);
  let subject: string;
  if (s.totalPublished === 0) {
    subject = t('Your Grove agent is getting started on {host}', { host: s.hostname });
  } else if (s.inReview > 0) {
    subject = s.inReview === 1
      ? t('1 draft waiting + your weekly Grove report')
      : t('{n} drafts waiting + your weekly Grove report', { n: s.inReview });
  } else if (s.readsThisWeek > 0 && d && d.dir !== 'flat') {
    subject = d.dir === 'up'
      ? t('{host}: reads up {pct}% this week', { host: s.hostname, pct: d.pct })
      : t('{host}: reads down {pct}% this week', { host: s.hostname, pct: d.pct });
  } else {
    subject = t('Your weekly Grove report for {host}', { host: s.hostname });
  }

  // ── text ───────────────────────────────────────────────────
  const textLines: string[] = [
    t('Your weekly Grove report — {host}', { host: s.hostname }),
    '',
    ...sentences.map((l) => `• ${l}`),
    '',
    ...chips.map((c) => `${c.label}: ${c.value}${c.sub ? ` (${c.sub})` : ''}`),
  ];
  if (s.topPost) textLines.push('', t('Top post: “{title}” — {n} reads', { title: s.topPost.title, n: s.topPost.views }));
  textLines.push('', `${ctaLabel}: ${ctaHref}`);
  textLines.push('', t("Don't want these? Turn off the weekly digest in your dashboard settings."));
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
         <div style="font-size:12px;color:${MUTE};text-transform:uppercase;letter-spacing:0.04em;">${esc(t('Top post this week'))}</div>
         <div style="font-size:15px;color:${INK};margin-top:4px;">${esc(t('“{title}” — {n} reads', { title: s.topPost.title, n: s.topPost.views }))}</div>
       </div>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef1ee;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ee;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e9e3;">
          <tr><td style="padding:24px 28px 8px;">
            <div style="font-family:Georgia,serif;font-size:13px;color:${MOSS};letter-spacing:0.06em;text-transform:uppercase;">${esc(t('Grove · weekly report'))}</div>
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
