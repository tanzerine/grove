/**
 * Owner/admin gating. The app has no role system, so "admin" is simply an
 * allow-list of email addresses (env GROVE_ADMIN_EMAILS, comma-separated).
 * Defaults to the founder's address so the refund admin view works out of the
 * box. Used server-side ONLY — never trust a client-supplied email; always
 * pass the email from a verified Supabase session.
 */
// The founder is ALWAYS an admin and can never be locked out, even if
// GROVE_ADMIN_EMAILS is set (or mis-set). By default the allow-list is exactly
// this one address — the admin area is owner-only unless you opt to add more.
const OWNER = 'tylee1171@snu.ac.kr';

export function adminEmails(): string[] {
  const raw = process.env.GROVE_ADMIN_EMAILS;
  const extra = raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  return Array.from(new Set([OWNER, ...extra]));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/** Where owner notifications are sent. Defaults to the first admin. */
export function ownerNotifyEmail(): string {
  return process.env.GROVE_OWNER_EMAIL || adminEmails()[0] || 'tylee1171@snu.ac.kr';
}
