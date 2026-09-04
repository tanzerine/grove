/**
 * The live half of the retrospective — SERVER-ONLY reads over what grove has
 * actually reached. Split from lib/journey.ts for the usual reason: that file
 * is pure data and safe to import anywhere, this one pulls the service-role
 * client.
 *
 * Every figure here is deliberately the OUTWARD one. The admin overview already
 * counts rows; this counts people. `total` users is 9 and has been for a month,
 * which is why the number that matters is `real` — signups that are neither me
 * nor an example.com fixture — and why `lastOutsideSignIn` is on the page at
 * all. A dashboard that reports 9 customers is not lying, but it is not telling
 * the truth either.
 *
 * Fail-soft per source, like lib/admin-stats.ts: one unreadable table degrades
 * to a zero, never a blank page.
 */
import { supabaseAdmin } from './supabase/admin';
import { adminEmails } from './admin';

const ACTIVE = ['active', 'trialing', 'past_due'];

/** Fixtures seeded into prod on 2026-08-02. Not customers, never were. */
const SEED_DOMAIN = 'example.com';

export type Reached = {
  users: { total: number; real: number; seeds: number; lastOutsideSignIn: string | null };
  paying: number;
  /** Comped/beta accounts are grants, not revenue — counted apart. */
  granted: number;
  posts: { created: number; published: number };
  search: { clicks: number; impressions: number; avgPosition: number | null };
  beta: { seats: number; redeemed: number };
  prospects: number;
  /** Feedback rows from someone who is not me. */
  outsideFeedback: number;
};

const EMPTY: Reached = {
  users: { total: 0, real: 0, seeds: 0, lastOutsideSignIn: null },
  paying: 0,
  granted: 0,
  posts: { created: 0, published: 0 },
  search: { clicks: 0, impressions: 0, avgPosition: null },
  beta: { seats: 0, redeemed: 0 },
  prospects: 0,
  outsideFeedback: 0,
};

function isSeed(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${SEED_DOMAIN}`);
}

export async function getReached(): Promise<Reached> {
  const admin = supabaseAdmin();
  const out: Reached = structuredClone(EMPTY);
  const mine = new Set(adminEmails());

  // ── who signed up, and which of them were strangers ──
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = data?.users ?? [];
    out.users.total = users.length;
    for (const u of users) {
      const email = u.email?.toLowerCase() ?? null;
      if (isSeed(email)) { out.users.seeds++; continue; }
      if (email && mine.has(email)) continue;
      out.users.real++;
      // The last time the product was opened by someone who wasn't me. This is
      // the single most honest number on the page.
      const seen = u.last_sign_in_at;
      if (seen && (!out.users.lastOutsideSignIn || seen > out.users.lastOutsideSignIn)) {
        out.users.lastOutsideSignIn = seen;
      }
    }
  } catch { /* auth unreadable — leave zeros */ }

  // ── money vs grants ──
  try {
    const { data } = await admin.from('subscriptions').select('stripe_status, comped, beta_code');
    for (const s of data ?? []) {
      const row = s as { stripe_status: string | null; comped: boolean | null; beta_code: string | null };
      // A comped account can carry stripe_status 'active' without a charge ever
      // having settled, so comped is checked FIRST. Otherwise dogfooding shows
      // up as revenue, which is the one direction this number must never err.
      if (row.comped || row.beta_code) { out.granted++; continue; }
      if (row.stripe_status && ACTIVE.includes(row.stripe_status)) out.paying++;
    }
  } catch { /* subscriptions unreadable */ }

  // ── what the machine produced ──
  try {
    const [{ count: created }, { count: published }] = await Promise.all([
      admin.from('posts').select('id', { count: 'exact', head: true }),
      admin.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    ]);
    out.posts.created = created ?? 0;
    out.posts.published = published ?? 0;
  } catch { /* posts unreadable */ }

  // ── and what it earned in search, on grove-written pages only ──
  try {
    const { data } = await admin
      .from('gsc_page_queries')
      .select('clicks, impressions, position')
      .not('post_id', 'is', null);
    const rows = (data ?? []) as { clicks: number; impressions: number; position: number }[];
    let posWeight = 0;
    for (const r of rows) {
      out.search.clicks += r.clicks ?? 0;
      out.search.impressions += r.impressions ?? 0;
      // Position averaged over impressions, not rows: a query with one
      // impression at #3 is not worth the same as one with four hundred at #22.
      posWeight += (r.position ?? 0) * (r.impressions ?? 0);
    }
    out.search.avgPosition = out.search.impressions > 0
      ? Math.round((posWeight / out.search.impressions) * 10) / 10
      : null;
  } catch { /* gsc unreadable */ }

  try {
    const { data } = await admin.from('beta_coupons').select('max_redemptions, redeemed_count');
    for (const c of data ?? []) {
      const row = c as { max_redemptions: number | null; redeemed_count: number | null };
      out.beta.seats += row.max_redemptions ?? 0;
      out.beta.redeemed += row.redeemed_count ?? 0;
    }
  } catch { /* beta tables unreadable */ }

  try {
    const { count } = await admin.from('outreach_prospects').select('id', { count: 'exact', head: true });
    out.prospects = count ?? 0;
  } catch { /* outreach unreadable */ }

  try {
    const { data } = await admin.from('feedback').select('email');
    out.outsideFeedback = (data ?? []).filter((f) => {
      const email = ((f as { email: string | null }).email ?? '').toLowerCase();
      return email && !mine.has(email) && !isSeed(email);
    }).length;
  } catch { /* feedback unreadable */ }

  return out;
}
