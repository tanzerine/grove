/**
 * Fair ordering for the scheduler's generation drain.
 *
 * The drain has a hard per-tick budget (a handful of posts under Vercel's
 * 300s ceiling), and the old "first N queued rows" pick let one domain with a
 * deep backlog occupy every slot, starving other customers for days.
 *
 * pickQueuedFairly is round-robin without any stored cursor:
 *  - pass 1 takes at most ONE post per domain, domains ordered by their
 *    oldest queued post. Serving a domain consumes that oldest post, so its
 *    ordering key advances while unserved domains keep theirs — whoever was
 *    skipped this tick automatically sorts first on the next one. Rotation
 *    falls out of the data; no state, no extra column.
 *  - pass 2 tops up any remaining slots with the remaining oldest posts, so
 *    a single-customer install still gets the full per-tick throughput.
 */

export type QueuedPost = { id: string; domain_id: string; created_at: string };

export function pickQueuedFairly<T extends QueuedPost>(queued: T[], limit: number): T[] {
  if (limit <= 0 || queued.length === 0) return [];

  // ISO timestamps compare correctly as strings; sort is stable so ties keep
  // their input order.
  const sorted = [...queued].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const picked: T[] = [];
  const servedDomains = new Set<string>();
  for (const p of sorted) {
    if (picked.length >= limit) return picked;
    if (servedDomains.has(p.domain_id)) continue;
    servedDomains.add(p.domain_id);
    picked.push(p);
  }
  const chosen = new Set(picked.map((p) => p.id));
  for (const p of sorted) {
    if (picked.length >= limit) break;
    if (chosen.has(p.id)) continue;
    picked.push(p);
  }
  return picked;
}
