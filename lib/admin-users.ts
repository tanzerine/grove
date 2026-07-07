/**
 * Admin per-user insight: retention, recent logins, time spent in-app,
 * referral source, and stated intent — everything the owner needs to judge
 * whether each customer is getting value. Server-only; pulls from the
 * service-role client. Gated by the caller (admin pages check isAdminEmail
 * first) — this module does NOT authorize; it only gathers.
 *
 * Every source is wrapped so a missing table (e.g. user_activity before the
 * 0019 migration lands) degrades to sign-in-based data instead of blanking
 * the page. The pure helpers (engagementStatus, cohortRetention, fmtDuration)
 * are exported for unit tests.
 */
import { supabaseAdmin } from './supabase/admin';

const DAY_MS = 86400_000;
const WEEK_MS = 7 * DAY_MS;
const ACTIVE_SUB = ['active', 'trialing', 'past_due'];

export type EngagementStatus = 'active' | 'cooling' | 'dormant' | 'never';

export type AdminUserRow = {
  id: string;
  email: string | null;
  createdAt: string;
  source: string;               // referral_source from signup metadata
  plan: string | null;          // active plan id, or null (free)
  sites: string[];              // hostnames of their domains
  verifiedSites: number;
  postsPublished: number;
  goal: string | null;          // onboarding interview: primary_goal
  kpi: string | null;           // onboarding interview: primary_kpi
  lastSeen: string | null;      // max(last sign-in, last activity beat)
  lastPath: string | null;      // last dashboard page they were on
  seconds7d: number;            // time in-app, last 7 days
  seconds30d: number;
  pageviews30d: number;
  activeDays30d: number;        // distinct days with in-app activity
  status: EngagementStatus;
};

export type CohortRow = {
  weekStart: string;            // ISO date (Monday, UTC) of the signup week
  size: number;
  cells: (number | null)[];     // % of cohort active in week N; null = future
};

export type AdminUserInsights = {
  tracked: boolean;             // user_activity has rows (0019 live + beats arriving)
  totals: {
    dau: number; wau: number; mau: number;
    avgSeconds7d: number;       // mean time-in-app across users active this week
    returning30d: number;       // users with ≥2 distinct active days in 30d
  };
  funnel: { signedUp: number; addedSite: number; verified: number; published: number; paying: number };
  cohorts: CohortRow[];
  users: AdminUserRow[];
};

// ── pure helpers ──────────────────────────────────────────────

/** Bucket a user by how recently they were seen. */
export function engagementStatus(lastSeenMs: number | null, nowMs: number): EngagementStatus {
  if (lastSeenMs == null) return 'never';
  const age = nowMs - lastSeenMs;
  if (age <= 7 * DAY_MS) return 'active';
  if (age <= 30 * DAY_MS) return 'cooling';
  return 'dormant';
}

/** "1h 05m" / "12m" / "45s" / "—". */
export function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** UTC midnight of the Monday starting the week that contains `ms`. */
function weekStartUtc(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(midnight).getUTCDay(); // 0 = Sun
  return midnight - ((dow + 6) % 7) * DAY_MS;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Weekly signup cohorts × weeks-since-signup retention grid.
 * `activeDays` maps user id → ISO days (yyyy-mm-dd, UTC) with any activity
 * (heartbeats and/or sign-ins). Cells are % of the cohort with ≥1 active day
 * in that week; weeks that haven't started yet are null.
 */
export function cohortRetention(
  users: { id: string; createdAt: string }[],
  activeDays: Map<string, string[]>,
  opts?: { weeks?: number; now?: number }
): CohortRow[] {
  const weeks = opts?.weeks ?? 8;
  const now = opts?.now ?? Date.now();
  const currentWeek = weekStartUtc(now);
  const oldestWeek = currentWeek - (weeks - 1) * WEEK_MS;

  const cohorts = new Map<number, { members: string[] }>();
  for (const u of users) {
    const ws = weekStartUtc(new Date(u.createdAt).getTime());
    if (ws < oldestWeek || ws > currentWeek) continue;
    const c = cohorts.get(ws) ?? { members: [] };
    c.members.push(u.id);
    cohorts.set(ws, c);
  }

  const rows: CohortRow[] = [];
  for (const [ws, c] of [...cohorts.entries()].sort((a, b) => b[0] - a[0])) {
    const cells: (number | null)[] = [];
    for (let i = 0; i < weeks; i++) {
      const start = ws + i * WEEK_MS;
      if (start > now) { cells.push(null); continue; }
      const end = start + WEEK_MS;
      let active = 0;
      for (const id of c.members) {
        const days = activeDays.get(id);
        if (days?.some((d) => {
          const t = Date.parse(`${d}T00:00:00Z`);
          return t >= start && t < end;
        })) active++;
      }
      cells.push(Math.round((active / c.members.length) * 100));
    }
    rows.push({ weekStart: isoDay(ws), size: c.members.length, cells });
  }
  return rows;
}

// ── data gathering ────────────────────────────────────────────

type ActivityRow = {
  user_id: string; day: string; seconds: number; pageviews: number;
  last_seen: string; last_path: string | null;
};

export async function getAdminUserInsights(now = Date.now()): Promise<AdminUserInsights> {
  const admin = supabaseAdmin();

  // Auth users — the spine of every row.
  let authUsers: any[] = [];
  try {
    // Early-stage scale: one page of up to 1000 is plenty (same call as
    // admin-stats). Revisit with pagination if the base outgrows it.
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    authUsers = data?.users ?? [];
  } catch { /* leave empty — page renders its empty state */ }

  // Subscriptions → active plan per user.
  const planByUser = new Map<string, string | null>();
  try {
    const { data } = await admin.from('subscriptions').select('user_id, plan, stripe_status');
    for (const s of data ?? []) {
      const st = (s as any).stripe_status as string | null;
      if (st && ACTIVE_SUB.includes(st)) planByUser.set((s as any).user_id, (s as any).plan ?? null);
    }
  } catch { /* no plans shown */ }

  // Domains → sites, verification, and the owner's stated intent.
  const sitesByUser = new Map<string, { hostname: string; verified: boolean; interview: any }[]>();
  const userByDomain = new Map<string, string>();
  try {
    const { data } = await admin.from('domains').select('id, user_id, hostname, verified_at, interview');
    for (const d of data ?? []) {
      const row = d as any;
      userByDomain.set(row.id, row.user_id);
      const list = sitesByUser.get(row.user_id) ?? [];
      list.push({ hostname: row.hostname, verified: !!row.verified_at, interview: row.interview ?? null });
      sitesByUser.set(row.user_id, list);
    }
  } catch { /* no sites shown */ }

  // Published posts per user (via their domains).
  const publishedByUser = new Map<string, number>();
  try {
    const { data } = await admin.from('posts').select('domain_id, status').eq('status', 'published');
    for (const p of data ?? []) {
      const uid = userByDomain.get((p as any).domain_id);
      if (uid) publishedByUser.set(uid, (publishedByUser.get(uid) ?? 0) + 1);
    }
  } catch { /* no post counts */ }

  // In-app activity (last 60 days — enough for the 8-week cohort grid).
  const actByUser = new Map<string, ActivityRow[]>();
  let tracked = false;
  try {
    const since = isoDay(now - 60 * DAY_MS);
    const { data, error } = await admin
      .from('user_activity')
      .select('user_id, day, seconds, pageviews, last_seen, last_path')
      .gte('day', since);
    if (!error) {
      for (const r of (data ?? []) as ActivityRow[]) {
        tracked = true;
        const list = actByUser.get(r.user_id) ?? [];
        list.push(r);
        actByUser.set(r.user_id, list);
      }
    }
  } catch { /* 0019 not migrated yet — sign-in data only */ }

  // Assemble per-user rows.
  const t7 = now - 7 * DAY_MS;
  const t30 = now - 30 * DAY_MS;
  const activeDaysForCohorts = new Map<string, string[]>();

  const users: AdminUserRow[] = authUsers.map((u) => {
    const acts = actByUser.get(u.id) ?? [];
    let seconds7d = 0, seconds30d = 0, pageviews30d = 0, activeDays30d = 0;
    let lastBeat = 0, lastPath: string | null = null;
    const days: string[] = [];
    for (const a of acts) {
      const dayMs = Date.parse(`${a.day}T00:00:00Z`);
      days.push(a.day);
      if (dayMs >= t30) {
        seconds30d += a.seconds;
        pageviews30d += a.pageviews;
        if (a.seconds > 0 || a.pageviews > 0) activeDays30d++;
        if (dayMs >= t7) seconds7d += a.seconds;
      }
      const seen = Date.parse(a.last_seen);
      if (seen > lastBeat) { lastBeat = seen; lastPath = a.last_path; }
    }

    const signIn = u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : 0;
    if (signIn) days.push(isoDay(signIn));
    activeDaysForCohorts.set(u.id, days);

    const lastSeenMs = Math.max(lastBeat, signIn) || null;
    const sites = sitesByUser.get(u.id) ?? [];
    const interviewed = sites.find((s) => s.interview && typeof s.interview === 'object');
    const iv = interviewed?.interview ?? {};

    return {
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at,
      source: (u.user_metadata?.referral_source as string) || 'Unknown',
      plan: planByUser.get(u.id) ?? null,
      sites: sites.map((s) => s.hostname),
      verifiedSites: sites.filter((s) => s.verified).length,
      postsPublished: publishedByUser.get(u.id) ?? 0,
      goal: typeof iv.primary_goal === 'string' ? iv.primary_goal : null,
      kpi: typeof iv.primary_kpi === 'string' ? iv.primary_kpi : null,
      lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      lastPath,
      seconds7d,
      seconds30d,
      pageviews30d,
      activeDays30d,
      status: engagementStatus(lastSeenMs, now),
    };
  });

  users.sort((a, b) => (b.lastSeen ? Date.parse(b.lastSeen) : 0) - (a.lastSeen ? Date.parse(a.lastSeen) : 0));

  // Aggregates. DAU/WAU/MAU from last-seen so they still work (sign-in based)
  // before activity tracking has data.
  const startOfToday = Date.parse(`${isoDay(now)}T00:00:00Z`);
  let dau = 0, wau = 0, mau = 0, activeTime = 0, activeTimeUsers = 0, returning30d = 0;
  for (const u of users) {
    const seen = u.lastSeen ? Date.parse(u.lastSeen) : 0;
    if (seen >= startOfToday) dau++;
    if (seen >= t7) wau++;
    if (seen >= t30) mau++;
    if (u.seconds7d > 0) { activeTime += u.seconds7d; activeTimeUsers++; }
    if (u.activeDays30d >= 2) returning30d++;
  }

  const funnel = {
    signedUp: users.length,
    addedSite: users.filter((u) => u.sites.length > 0).length,
    verified: users.filter((u) => u.verifiedSites > 0).length,
    published: users.filter((u) => u.postsPublished > 0).length,
    paying: users.filter((u) => u.plan != null).length,
  };

  return {
    tracked,
    totals: {
      dau, wau, mau,
      avgSeconds7d: activeTimeUsers ? Math.round(activeTime / activeTimeUsers) : 0,
      returning30d,
    },
    funnel,
    cohorts: cohortRetention(
      users.map((u) => ({ id: u.id, createdAt: u.createdAt })),
      activeDaysForCohorts,
      { now }
    ),
    users,
  };
}
