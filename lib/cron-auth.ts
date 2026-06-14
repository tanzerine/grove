/**
 * Shared authorization for /api/cron/* routes.
 *
 * When CRON_SECRET is set, Vercel automatically sends it as
 * `Authorization: Bearer <CRON_SECRET>` on every scheduled invocation, so a
 * constant-time compare against that header is all we need.
 *
 * We deliberately do NOT trust the `x-vercel-cron` header: Vercel does not
 * strip inbound copies of it, so any external caller can set it and would
 * otherwise be able to trigger expensive generation / publishing / email runs.
 *
 * Fails CLOSED — if CRON_SECRET is unset we reject, rather than leaving the
 * endpoints open.
 */
import { timingSafeEqual } from 'crypto';

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed

  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
