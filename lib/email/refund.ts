/**
 * Compose the owner notification email for a refund request. Pure: no DB, no
 * env, no network — so the copy is unit-testable. The submit endpoint gathers
 * the fields and hands them here, then sends via lib/email/resend.
 *
 * The email is a NOTICE + a deep link to the admin view. It deliberately does
 * NOT contain any action that moves money (no one-click-refund link that an
 * email scanner could prefetch) — the owner clicks through, authenticates, and
 * approves there.
 */
import { reasonLabel } from '../refunds';

export type RefundEmailInput = {
  email: string | null;
  plan: string | null;
  reason: string | null;
  feedback: string | null;
  comeback: string | null;
  hasCharge: boolean;
  amountLabel: string | null; // e.g. "$29.00 USD" when known
  adminUrl: string;
};

export type ComposedEmail = { subject: string; html: string; text: string };

const INK = '#1c2620';
const MUTE = '#6b7770';
const MOSS = '#59945e';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function composeRefundOwnerEmail(i: RefundEmailInput): ComposedEmail {
  const who = i.email ?? 'A customer';
  const planTxt = i.plan ? i.plan.charAt(0).toUpperCase() + i.plan.slice(1) : 'unknown plan';
  const subject = `Refund request — ${i.email ?? 'customer'} (${planTxt})`;

  const rows: [string, string][] = [
    ['Customer', i.email ?? '—'],
    ['Plan', planTxt],
    ['Reason', reasonLabel(i.reason)],
    ['What we could do better', i.feedback?.trim() || '—'],
    ['What would bring them back', i.comeback?.trim() || '—'],
    ['Refundable charge', i.hasCharge ? (i.amountLabel ?? 'yes') : 'none found (no successful payment)'],
  ];

  const text = [
    `Refund request from ${who}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    i.hasCharge
      ? 'Review and issue the refund here (you approve it — nothing has been charged back yet):'
      : 'No successful charge was found, so there may be nothing to refund. Review here:',
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
    <h2 style="font-size:18px;color:${INK};margin:0 0 4px;">Refund request</h2>
    <p style="font-size:14px;color:${MUTE};margin:0 0 16px;">${esc(who)} wants to cancel and be refunded.</p>
    <table style="width:100%;border-collapse:collapse;background:#f7f9f7;border:1px solid #e2e9e3;border-radius:10px;overflow:hidden;">
      ${rowsHtml}
    </table>
    <p style="margin:18px 0 0;">
      <a href="${esc(i.adminUrl)}" style="display:inline-block;background:${MOSS};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:9px;">
        Review &amp; issue refund
      </a>
    </p>
    <p style="font-size:12px;color:${MUTE};margin:14px 0 0;">
      ${
        i.hasCharge
          ? 'Nothing has been refunded yet — you approve it from the admin view.'
          : 'No successful charge was found, so there may be nothing to refund.'
      }
    </p>
  </div>`;

  return { subject, html, text };
}
