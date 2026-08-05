/**
 * Is a stored social connection still usable — and if not, what does the owner
 * need to do about it?
 *
 * Cross-posting tokens die in two different ways, and grove already detected
 * both without ever telling anyone:
 *
 *   1. X rotates a short-lived (~2h) access token and grove refreshes it
 *      automatically (lib/social/oauth getLiveConnections). That works until the
 *      REFRESH token itself is revoked — app permissions changed, the user
 *      un-authorised grove — after which every post 401s forever. There is no
 *      expiry date to look at; the only signal is the failed post.
 *   2. LinkedIn hands out a 60-day token and NO refresh token, so there is
 *      nothing to refresh. `expires_at` is the whole signal, and it is knowable
 *      in advance — which means the owner can be warned BEFORE the first post
 *      is lost rather than after.
 *
 * So health reads both: the per-post error the publisher recorded, and the
 * stored expiry of a connection that can't refresh itself. Pure on purpose —
 * this is the code that decides whether a customer is told their channel is
 * broken, so it is unit-tested rather than eyeballed in the dashboard.
 */

/** One channel's entry in posts.social_published. */
export type ShareRecord = {
  id?: string;
  at?: string;
  status?: number;
  error?: string;
  dry_run?: boolean;
};

/**
 * What actually happened on a channel.
 *
 * `posted` REQUIRES an id (or a dry-run marker). The dashboard used to treat
 * the record's mere existence as success — but a failure is also a record, so a
 * permanently broken channel rendered as a green "Posted". Reporting a failure
 * as a success is worse than reporting nothing.
 */
export type ShareOutcome = 'posted' | 'failed' | 'dry_run' | 'pending';

export function shareOutcome(rec: ShareRecord | null | undefined): ShareOutcome {
  if (!rec) return 'pending';
  if (rec.dry_run) return 'dry_run';
  if (rec.error) return 'failed';
  // The webhook records `status` instead of an id; a 2xx is a delivery.
  if (rec.id) return 'posted';
  if (typeof rec.status === 'number') return rec.status >= 200 && rec.status < 300 ? 'posted' : 'failed';
  return 'pending';
}

/**
 * Does this error mean the AUTHORIZATION is gone (so the fix is a reconnect),
 * as opposed to a transient or account-level problem the owner can't fix by
 * reconnecting? The publisher writes these strings itself (lib/social/publish),
 * so the common cases are matched on the sentences we control, with the raw
 * provider vocabulary as a fallback for anything that reaches us verbatim.
 *
 * Deliberately does NOT match X's 402 credits-depleted or a 429 rate limit —
 * both are real failures, neither is fixed by reconnecting, and telling someone
 * to re-authorise an account that is working fine wastes their time and teaches
 * them to ignore the badge.
 */
export function isAuthError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (/quota|credits|rate limit|429|402/.test(m)) return false;
  return /expired|reconnect|unauthor|invalid[_ ]grant|invalid[_ ]token|revoked|\b401\b/.test(m);
}

export type ConnectionHealthState = 'ok' | 'expiring' | 'expired' | 'failing';

export type ConnectionHealth = {
  state: ConnectionHealthState;
  /** Short badge text. */
  label: string;
  /** One sentence of what to do, when there is something to do. */
  detail?: string;
  /** Should the UI offer a Reconnect button instead of a plain Disconnect? */
  needsReconnect: boolean;
};

/** How far ahead of a non-refreshable expiry to start warning. LinkedIn's token
 *  lasts 60 days, so a week is plenty of notice without nagging for two months. */
export const EXPIRY_WARNING_MS = 7 * 24 * 3600_000;

export function daysUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / (24 * 3600_000)));
}

export function connectionHealth(
  input: {
    /** social_connections.expires_at — null means the provider gave no expiry. */
    expiresAt?: string | null;
    /** Does the connection carry a refresh token grove can use unattended? */
    canRefresh: boolean;
    /** Most recent per-post error for this platform, if any. */
    lastError?: string | null;
  },
  now: number = Date.now(),
): ConnectionHealth {
  const { expiresAt, canRefresh, lastError } = input;

  // A real failed post outranks any expiry arithmetic: it is what actually
  // happened, and for a revoked X refresh token it is the ONLY signal there is.
  if (lastError) {
    if (isAuthError(lastError)) {
      return {
        state: 'failing',
        label: 'Reconnect needed',
        detail: 'Authorization is no longer valid — reconnect to resume posting.',
        needsReconnect: true,
      };
    }
    return {
      state: 'failing',
      label: 'Last post failed',
      detail: lastError.slice(0, 160),
      needsReconnect: false,
    };
  }

  // Expiry only matters when nothing can refresh it. A connection with a
  // refresh token renews itself, so counting down its 2-hour access token would
  // mark a perfectly healthy channel as expiring every couple of hours.
  if (!canRefresh && expiresAt) {
    const t = new Date(expiresAt).getTime();
    if (Number.isFinite(t)) {
      if (t <= now) {
        return {
          state: 'expired',
          label: 'Expired',
          detail: 'This authorization has expired — reconnect to resume posting.',
          needsReconnect: true,
        };
      }
      if (t - now <= EXPIRY_WARNING_MS) {
        const d = daysUntil(expiresAt, now);
        return {
          state: 'expiring',
          label: `Expires in ${d} ${d === 1 ? 'day' : 'days'}`,
          detail: 'Reconnect before it lapses to keep cross-posting without a gap.',
          needsReconnect: true,
        };
      }
    }
  }

  return { state: 'ok', label: 'Connected', needsReconnect: false };
}

/**
 * The most recent error per platform across recent posts.
 *
 * `posts` must be newest-first. A channel that succeeded on a newer post is
 * healthy again (the owner pressed Retry, or reconnected), so a later success
 * clears an earlier failure rather than the badge sticking forever.
 */
export function latestChannelErrors(
  posts: { social_published?: Record<string, ShareRecord> | null }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const settled = new Set<string>();
  for (const p of posts) {
    for (const [platform, rec] of Object.entries(p.social_published ?? {})) {
      if (settled.has(platform)) continue;
      const outcome = shareOutcome(rec);
      if (outcome === 'pending') continue;      // tells us nothing either way
      settled.add(platform);                     // newest verdict wins
      if (outcome === 'failed' && rec?.error) out[platform] = rec.error;
    }
  }
  return out;
}
