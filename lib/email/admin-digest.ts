/**
 * Compose the daily admin digest email — business snapshot + any anomaly
 * flags. Pure: takes the gathered stats + flags and returns {subject,html,text}.
 * The cron (app/api/cron/admin-digest) gathers and sends.
 */
import type { AdminStats } from '../admin-stats';
import type { Flag } from '../anomaly';

export type ComposedEmail = { subject: string; html: string; text: string };

const INK = '#1c2620';
const MUTE = '#6b7770';
const MOSS = '#59945e';
const RED = '#c0392b';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function composeAdminDigestEmail(stats: AdminStats, flags: Flag[], baseUrl: string): ComposedEmail {
  const critical = flags.filter((f) => f.severity === 'critical').length;
  const dash = baseUrl.replace(/\/$/, '') + '/dashboard/admin';

  // ── subject ──
  let subject: string;
  if (critical > 0) subject = `⚠️ Grove alert (${critical}) + daily report`;
  else if (flags.length > 0) subject = `Grove daily — ${flags.length} thing${flags.length === 1 ? '' : 's'} to check`;
  else subject = `Grove daily — ${stats.users.new7d} new this week, $${stats.subs.mrrUsd} MRR`;

  const statLines: [string, string][] = [
    ['New signups (24h / 7d)', `${stats.users.new30d >= 0 ? '' : ''}${signupsToday(stats)} / ${stats.users.new7d}`],
    ['Total customers', String(stats.users.total)],
    ['Active subscriptions', String(stats.subs.active)],
    ['MRR', `$${stats.subs.mrrUsd}`],
    ['Pending refunds', String(stats.refunds.pending)],
  ];

  // ── text ──
  const textLines: string[] = [`Grove daily report`, ''];
  if (flags.length) {
    textLines.push('ALERTS:');
    for (const f of flags) textLines.push(`  [${f.severity.toUpperCase()}] ${f.title} — ${f.detail}`);
    textLines.push('');
  }
  for (const [k, v] of statLines) textLines.push(`${k}: ${v}`);
  if (stats.referrals.length) {
    textLines.push('', 'How they found us:');
    for (const r of stats.referrals.slice(0, 6)) textLines.push(`  ${r.source}: ${r.count}`);
  }
  textLines.push('', `Open the admin overview: ${dash}`);
  const text = textLines.join('\n');

  // ── html ──
  const alertsHtml = flags.length
    ? `<div style="margin:0 0 18px;">
        ${flags
          .map((f) => {
            const c = f.severity === 'critical' ? RED : '#b8860b';
            return `<div style="border-left:3px solid ${c};background:${f.severity === 'critical' ? '#fdf0ee' : '#fbf6e9'};padding:10px 14px;border-radius:6px;margin-bottom:8px;">
              <div style="font-size:13px;font-weight:700;color:${c};">${f.severity === 'critical' ? '⚠️ ' : ''}${esc(f.title)}</div>
              <div style="font-size:13px;color:${INK};margin-top:2px;">${esc(f.detail)}</div>
            </div>`;
          })
          .join('')}
      </div>`
    : `<p style="font-size:13px;color:${MOSS};margin:0 0 16px;">✓ No anomalies flagged in the last hour.</p>`;

  const statsHtml = statLines
    .map(
      ([k, v]) => `<tr>
        <td style="padding:7px 12px;font-size:13px;color:${MUTE};">${esc(k)}</td>
        <td style="padding:7px 12px;font-size:14px;font-weight:600;color:${INK};text-align:right;">${esc(v)}</td>
      </tr>`,
    )
    .join('');

  const refsHtml = stats.referrals.length
    ? `<div style="margin-top:16px;"><div style="font-size:12px;color:${MUTE};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">How they found us</div>
        ${stats.referrals
          .slice(0, 6)
          .map((r) => `<div style="font-size:13px;color:${INK};padding:2px 0;">${esc(r.source)} — ${r.count}</div>`)
          .join('')}</div>`
    : '';

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="font-size:18px;color:${INK};margin:0 0 4px;">Grove daily report</h2>
    <p style="font-size:13px;color:${MUTE};margin:0 0 16px;">Your business at a glance.</p>
    ${alertsHtml}
    <table style="width:100%;border-collapse:collapse;background:#f7f9f7;border:1px solid #e2e9e3;border-radius:10px;overflow:hidden;">${statsHtml}</table>
    ${refsHtml}
    <p style="margin:18px 0 0;">
      <a href="${esc(dash)}" style="display:inline-block;background:${MOSS};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:9px;">Open admin overview</a>
    </p>
  </div>`;

  return { subject, html, text };
}

// We don't track signup timestamps to the hour in AdminStats; approximate
// "today" as same-day count from the recent list (good enough for the digest).
function signupsToday(stats: AdminStats): number {
  const today = new Date().toDateString();
  return stats.users.recent.filter((u) => new Date(u.createdAt).toDateString() === today).length;
}
