/**
 * Owner/admin gating. The app has no role system, so "admin" is simply an
 * allow-list of email addresses (env GROVE_ADMIN_EMAILS, comma-separated).
 * Defaults to the founder's address so the refund admin view works out of the
 * box. Used server-side ONLY — never trust a client-supplied email; always
 * pass the email from a verified Supabase session.
 */
const DEFAULT_ADMINS = ['tylee1171@snu.ac.kr'];

export function adminEmails(): string[] {
  const raw = process.env.GROVE_ADMIN_EMAILS;
  const list = raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ADMINS;
  return list;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/** Where owner notifications are sent. Defaults to the first admin. */
export function ownerNotifyEmail(): string {
  return process.env.GROVE_OWNER_EMAIL || adminEmails()[0] || 'tylee1171@snu.ac.kr';
}
