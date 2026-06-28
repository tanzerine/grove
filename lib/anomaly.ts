/**
 * Lightweight anomaly detection for the admin overview + daily digest.
 *
 * Reads existing first-party signals (no new tables): rate_hits (API request
 * volume + denial-of-wallet), post_events (traffic / bot / single-source
 * hammering), auth signups, and recent Stripe charges (card-testing fraud).
 *
 * Server-only, service-role, and fail-soft: any source that errors is skipped
 * rather than throwing. Thresholds are deliberately generous for an early-stage
 * product — tune the T constants (or wire to env) as real traffic establishes a
 * baseline. The hard protection is the rate limiter; these flags are awareness.
 */
import { supabaseAdmin } from './supabase/admin';
import { getStripe, stripeConfigured } from './stripe';
import { LIMITS } from './ratelimit';

export type Flag = {
  key: string;
  severity: 'warn' | 'critical';
  title: string;
  detail: string;
};

// Thresholds. Absolute numbers + a relative multiplier vs the trailing baseline.
const T = {
  apiWarn: 300, apiCrit: 1000,          // rate_hits in the last hour
  trafficWarn: 800, trafficCrit: 4000,  // post_events (views) in the last hour
  trafficRelMin: 150, trafficRelMult: 6, // relative spike vs 24h hourly average
  botMinViews: 80, botRatio: 0.6,       // bot share of last-hour traffic
  ipHammerPerHour: 250,                 // events from one /24 (or /48) ip prefix
  signupWarn: 8, signupCrit: 30,        // new users in the last hour
  failedPayWarn: 4, failedPayCrit: 15,  // failed charges in the last 24h
};

const iso = (ms: number) => new Date(ms).toISOString();

export async function detectAnomalies(): Promise<Flag[]> {
  const admin = supabaseAdmin();
  const now = Date.now();
  const h1 = iso(now - 3600_000);
  const h24 = iso(now - 24 * 3600_000);
  const flags: Flag[] = [];

  // ── API request volume + denial-of-wallet (rate_hits) ──
  try {
    const { data } = await admin
      .from('rate_hits')
      .select('bucket')
      .gte('created_at', h1)
      .limit(5000);
    const rows = data ?? [];
    const apiTotal = rows.length;
    if (apiTotal >= T.apiCrit) {
      flags.push({ key: 'api_spike', severity: 'critical', title: 'API request spike', detail: `${apiTotal} rate-limited API hits in the last hour.` });
    } else if (apiTotal >= T.apiWarn) {
      flags.push({ key: 'api_spike', severity: 'warn', title: 'Elevated API usage', detail: `${apiTotal} API hits in the last hour.` });
    }

    // Any single cost-bearing bucket sitting at its ceiling = someone being
    // throttled hard (possible denial-of-wallet attempt — already blocked).
    const byBucket = new Map<string, number>();
    for (const r of rows) byBucket.set((r as any).bucket, (byBucket.get((r as any).bucket) ?? 0) + 1);
    for (const [bucket, count] of byBucket) {
      const prefix = bucket.split(':')[0] as keyof typeof LIMITS;
      const limit = LIMITS[prefix]?.limit;
      if (limit && count >= limit) {
        flags.push({ key: 'wallet_ratelimit', severity: 'warn', title: 'Cost endpoint at its limit', detail: `Bucket "${bucket}" hit its ${limit}/hr cap — repeated throttling (denial-of-wallet attempt blocked).` });
        break; // one flag is enough; detail names the worst offender
      }
    }
  } catch { /* rate_hits unreadable */ }

  // ── Traffic / bot / single-source hammering (post_events) ──
  try {
    const { data } = await admin
      .from('post_events')
      .select('type, ua_kind, ip_prefix')
      .gte('created_at', h1)
      .limit(8000);
    const rows = data ?? [];
    const views = rows.filter((r) => (r as any).type === 'view');
    const viewCount = views.length;
    const botCount = views.filter((r) => (r as any).ua_kind === 'bot').length;

    // 24h baseline for relative spike detection.
    let baselineHourly = 0;
    try {
      const { count } = await admin
        .from('post_events')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'view')
        .gte('created_at', h24);
      baselineHourly = (count ?? 0) / 24;
    } catch { /* baseline optional */ }

    const relSpike = viewCount > T.trafficRelMin && baselineHourly > 0 && viewCount > baselineHourly * T.trafficRelMult;
    if (viewCount >= T.trafficCrit) {
      flags.push({ key: 'traffic_spike', severity: 'critical', title: 'Traffic spike', detail: `${viewCount} page views in the last hour.` });
    } else if (viewCount >= T.trafficWarn || relSpike) {
      flags.push({ key: 'traffic_spike', severity: 'warn', title: 'Traffic spike', detail: `${viewCount} page views in the last hour${baselineHourly ? ` (~${Math.round(baselineHourly)}/hr typical)` : ''}.` });
    }

    if (viewCount >= T.botMinViews && botCount / viewCount >= T.botRatio) {
      flags.push({ key: 'bot_traffic', severity: 'warn', title: 'High bot traffic', detail: `${Math.round((botCount / viewCount) * 100)}% of the last hour's ${viewCount} views were bots.` });
    }

    const byIp = new Map<string, number>();
    for (const r of rows) {
      const ip = (r as any).ip_prefix as string | null;
      if (ip) byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
    }
    for (const [ip, count] of byIp) {
      if (count >= T.ipHammerPerHour) {
        flags.push({ key: 'ip_hammer', severity: 'warn', title: 'Single source hammering', detail: `One IP range (${ip}) made ${count} events in the last hour.` });
        break;
      }
    }
  } catch { /* post_events unreadable */ }

  // ── Signup spike (possible bot wave) ──
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const cutoff = now - 3600_000;
    const recent = (data?.users ?? []).filter((u) => new Date(u.created_at).getTime() >= cutoff).length;
    if (recent >= T.signupCrit) {
      flags.push({ key: 'signup_spike', severity: 'critical', title: 'Signup surge', detail: `${recent} new accounts in the last hour — possible bot wave.` });
    } else if (recent >= T.signupWarn) {
      flags.push({ key: 'signup_spike', severity: 'warn', title: 'Signup surge', detail: `${recent} new accounts in the last hour.` });
    }
  } catch { /* listUsers unavailable */ }

  // ── Failed payments (card-testing fraud) ──
  if (stripeConfigured()) {
    try {
      const charges = await getStripe().charges.list({ created: { gte: Math.floor((now - 24 * 3600_000) / 1000) }, limit: 100 });
      const failed = charges.data.filter((c) => c.status === 'failed').length;
      if (failed >= T.failedPayCrit) {
        flags.push({ key: 'failed_payments', severity: 'critical', title: 'Many failed payments', detail: `${failed} failed charges in the last 24h — possible card testing.` });
      } else if (failed >= T.failedPayWarn) {
        flags.push({ key: 'failed_payments', severity: 'warn', title: 'Failed payments', detail: `${failed} failed charges in the last 24h.` });
      }
    } catch { /* Stripe read failed */ }
  }

  return flags;
}
