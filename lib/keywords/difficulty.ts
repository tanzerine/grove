/**
 * Grove difficulty — how hard a keyword's top 10 is, from DataForSEO's RAW
 * numbers rather than its KD.
 *
 * ── Why KD alone is not a difficulty ───────────────────────────────────────
 * DataForSEO's `keyword_difficulty` is a log-scaled count of the links
 * pointing at the ten ranking PAGES. It never looks at the domains those pages
 * sit on. So a SERP owned by Play Store listings, Adobe help pages and Flaticon
 * asset pages — pages nobody links to individually, on domains everybody links
 * to — reads as KD 0, "trivially winnable". Measured 2026-09-23:
 *
 *   keyword               KD   avg domain rank   what holds it
 *   pixel 3d icon pack     0         599         Android icon packs
 *   messenger 3d icon      0         649         asset libraries
 *   3d icon ios            0         690         Apple / asset libraries
 *   illustrator 3d logo    0         842         Adobe, YouTube, Reddit
 *   3d icon generator     21         426         small tool sites
 *
 * The only keyword there a blog post can actually win — oveners ranks 13.5 on
 * it and has taken 16 clicks — is the one with the HIGHEST KD. KD sorted them
 * backwards. The domain rank did not, and it arrives in the same Labs response
 * (`avg_backlinks_info.main_domain_rank`), for free, and was being thrown away.
 *
 * ── The score is the harder of two walls ───────────────────────────────────
 *   link wall       = the provider's KD (page-level links)
 *   authority wall  = the top 10's average domain rank, 350 → 0 … 750 → 100
 *   difficulty      = max(link, authority) + 15 if the SERP isn't for articles
 *
 * max, not a blend: either wall alone keeps a young site out, and averaging a
 * brutal wall with an absent one is how "KD 0 on Adobe's SERP" happened.
 *
 * ── Dead space is a separate verdict, not a big difficulty ─────────────────
 * oveners DOES rank 9.7 on "illustrator 3d logo" — 116 impressions, zero
 * clicks. A household-name SERP is not unrankable; it is worthless to rank
 * in, because the names take every slot that earns a click. That is a
 * different fact from "hard", so it is reported as its own flag and rejected
 * outright, whatever the volume.
 *
 * ── These are stated priors, not a fitted model ────────────────────────────
 * Every threshold below is a claim someone can argue with, calibrated against
 * the handful of oveners outcomes above. grove has four clicks of platform-wide
 * ground truth; a fitted coefficient would imply a confidence that does not
 * exist. Change a number here when an outcome disagrees with it, and say which.
 */

/** What Labs reports about a keyword's current top 10, averaged. */
export type SerpAuthority = {
  /** Average main-domain rank of the top 10, 0-1000 (DataForSEO rank scale). */
  domainRank: number | null;
  /** Average page rank of the top 10, 0-1000. */
  pageRank: number | null;
  /** Average referring main domains per ranking page. */
  referringDomains: number | null;
  /** SERP element types present (organic, app, shopping, video, …). */
  features: string[];
};

/**
 * A domain at or above this rank is a household name: youtube 1000, adobe
 * 842, reddit 818, canva 694. figma (604) and chatgpt (636) sit under it on
 * purpose — the pages they rank are community plugins and user-made GPTs,
 * which small sites do displace (both appear mid-SERP on "3d icon generator",
 * where oveners ranks).
 */
export const GIANT_DOMAIN_RANK = 650;

/** Authority wall: an average domain rank at or under this costs nothing… */
const AUTHORITY_FLOOR = 350;
/** …and at or over this is the whole 100. Linear between. */
const AUTHORITY_CEIL = 750;

/**
 * A provider KD under this, with no authority data to check it against, is
 * treated as UNKNOWN rather than easy. Low KD is exactly how a SERP of
 * unlinked pages on giant domains reads, so on its own it cannot tell "empty"
 * from "owned by Adobe".
 */
export const UNTRUSTED_KD = 15;

/** Added when the SERP is built for something other than an article. */
const FORMAT_PENALTY = 15;

/**
 * SERP elements that mean the searcher wants a product, a place or an app —
 * a result type an article cannot be. Their presence pushes the organic
 * results down AND says the organic ones that remain answer a different need.
 */
const NON_ARTICLE_FEATURES = new Set([
  'app', 'shopping', 'popular_products', 'local_pack', 'map', 'hotels_pack',
  'google_hotels', 'google_flights', 'jobs', 'explore_brands', 'find_results',
]);

export type DifficultyBasis = 'serp' | 'kd_only' | 'none';

export type Difficulty = {
  /** 0-100, higher is harder. Null = unknown, never "easy". */
  score: number | null;
  basis: DifficultyBasis;
  /** Household names hold the SERP: rank there and earn nothing. */
  deadSpace: boolean;
  /** Short, English, operator-facing — for logs and the planner's prompt. */
  reasons: string[];
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Pull the authority half out of a Labs item. Null when Labs sent no
 * `avg_backlinks_info`, or sent one with no domain rank in it — a 0 rank
 * there means "no data", not "a SERP of rank-0 domains", since even a
 * brand-new site carries a rank above zero once it holds a top-10 slot.
 */
export function parseSerpAuthority(item: any): SerpAuthority | null {
  const bl = item?.avg_backlinks_info;
  if (!bl || typeof bl !== 'object') return null;
  const domainRank = num(bl.main_domain_rank);
  if (domainRank == null || domainRank <= 0 || domainRank > 1000) return null;
  const pageRank = num(bl.rank);
  const types = item?.serp_info?.serp_item_types;
  return {
    domainRank,
    pageRank: pageRank != null && pageRank >= 0 && pageRank <= 1000 ? pageRank : null,
    referringDomains: num(bl.referring_main_domains),
    features: Array.isArray(types) ? types.filter((t: unknown): t is string => typeof t === 'string') : [],
  };
}

/** Authority wall, 0-100, from an average domain rank on the 0-1000 scale. */
export function authorityDifficulty(domainRank: number): number {
  if (domainRank <= AUTHORITY_FLOOR) return 0;
  if (domainRank >= AUTHORITY_CEIL) return 100;
  return Math.round(((domainRank - AUTHORITY_FLOOR) / (AUTHORITY_CEIL - AUTHORITY_FLOOR)) * 100);
}

/**
 * Link wall when the provider sent no KD but did send link counts. KD is
 * log-scaled in referring domains; 20·log10(1+rd) puts "3d icon generator"
 * (10.4 referring domains, KD 21) where the provider does. One calibration
 * point — it is a fallback, and it is labelled as one.
 */
export function linkDifficulty(referringDomains: number): number {
  return Math.min(100, Math.round(20 * Math.log10(1 + Math.max(0, referringDomains))));
}

/**
 * The verdict for one keyword. Pure.
 *
 * `providerKd` is DataForSEO's KD as sent (already range-checked); `serp` is
 * the authority half, when Labs had it.
 */
export function groveDifficulty(providerKd: number | null, serp: SerpAuthority | null): Difficulty {
  if (serp && serp.domainRank != null) {
    const reasons: string[] = [];
    const link = providerKd ?? (serp.referringDomains != null ? linkDifficulty(serp.referringDomains) : 0);
    const authority = authorityDifficulty(serp.domainRank);
    let score = Math.max(link, authority);
    if (authority > link) {
      reasons.push(`top 10 averages domain rank ${Math.round(serp.domainRank)}/1000` +
        (providerKd != null ? ` — harder than KD ${providerKd} says` : ''));
    }
    const offFormat = serp.features.filter((f) => NON_ARTICLE_FEATURES.has(f));
    if (offFormat.length) {
      score += FORMAT_PENALTY;
      reasons.push(`SERP is built for ${offFormat.join('/')}, not articles`);
    }
    const deadSpace = serp.domainRank >= GIANT_DOMAIN_RANK;
    if (deadSpace) reasons.push('household-name SERP: ranking there earns no clicks');
    return { score: Math.min(100, score), basis: 'serp', deadSpace, reasons };
  }
  if (providerKd != null) {
    if (providerKd < UNTRUSTED_KD) {
      return {
        score: null, basis: 'kd_only', deadSpace: false,
        reasons: [`KD ${providerKd} with no authority data — reads the same as a SERP of giant domains`],
      };
    }
    return { score: providerKd, basis: 'kd_only', deadSpace: false, reasons: [] };
  }
  return { score: null, basis: 'none', deadSpace: false, reasons: [] };
}

// ── per-slot: who holds each of the ten ───────────────────────────────────
// An average can't see the shape of a SERP. Three giants on top and seven
// small sites below average out to "moderate", and that SERP is dead space
// for clicks. Labs' historical_serps carries each slot's domain rank, so the
// finalists — the few pillars that might actually become articles — get
// looked at slot by slot.

export type SerpSlot = { rank: number; host: string; domainRank: number | null; pageRank: number | null };

export type SlotSnapshot = { at: string; slots: SerpSlot[] };

/** Older than this and a snapshot says more about last year than this one. */
export const MAX_SNAPSHOT_AGE_DAYS = 548;

/**
 * The newest usable snapshot from a historical_serps response, or null.
 * Pure. Labs returns several snapshots a year for a busy keyword and none
 * for a quiet one; the newest wins, and one past MAX_SNAPSHOT_AGE_DAYS is
 * treated as absent rather than trusted.
 */
export function parseHistoricalSerp(json: any, now: Date = new Date()): SlotSnapshot | null {
  const task = json?.tasks?.[0];
  if (!task || (typeof task.status_code === 'number' && task.status_code !== 20000)) return null;
  const snaps: any[] = task?.result?.[0]?.items ?? [];
  if (!Array.isArray(snaps) || !snaps.length) return null;
  const time = (s: any) => {
    const t = Date.parse(String(s?.datetime ?? '').replace(' +00:00', 'Z').replace(' ', 'T'));
    return Number.isFinite(t) ? t : -Infinity;
  };
  const newest = snaps.reduce((a, b) => (time(b) > time(a) ? b : a));
  const at = time(newest);
  if (!Number.isFinite(at) || (now.getTime() - at) / 86_400_000 > MAX_SNAPSHOT_AGE_DAYS) return null;
  const slots: SerpSlot[] = (newest?.items ?? [])
    .filter((it: any) => it?.type === 'organic' && typeof it?.domain === 'string')
    .map((it: any) => {
      const dr = num(it?.rank_info?.main_domain_rank);
      const pr = num(it?.rank_info?.page_rank);
      return {
        rank: num(it?.rank_group) ?? 0,
        host: String(it.domain).toLowerCase().replace(/^www\./, ''),
        domainRank: dr != null && dr > 0 ? dr : null,
        pageRank: pr,
      };
    })
    .sort((a: SerpSlot, b: SerpSlot) => a.rank - b.rank)
    .slice(0, 10);
  if (!slots.length) return null;
  return { at: new Date(at).toISOString(), slots };
}

export type SlotVerdict = {
  /** Slots held by household names (domain rank ≥ GIANT_DOMAIN_RANK). */
  giants: number;
  /** Rank of the first slot a giant does not hold — the best seat on offer. */
  firstOpen: number | null;
  deadSpace: boolean;
  reason: string | null;
};

/**
 * Dead space, slot by slot. Pure.
 *
 * Dead when giants hold all of the top three — everything left is below the
 * fold of the clicks — or seven of the ten, where there is barely a seat at
 * all. A slot with no rank data is counted as NOT a giant, so a gap in the
 * data can only make a SERP look more open, never condemn it.
 *
 * `ownHost` is excluded: a domain already holding a slot is not blocked by
 * its own page.
 */
export function slotVerdict(snap: SlotSnapshot, ownHost?: string | null): SlotVerdict {
  const own = (ownHost ?? '').toLowerCase().replace(/^www\./, '');
  const isGiant = (s: SerpSlot) =>
    s.domainRank != null && s.domainRank >= GIANT_DOMAIN_RANK && !(own && (s.host === own || s.host.endsWith(`.${own}`)));
  const giants = snap.slots.filter(isGiant).length;
  const firstOpen = snap.slots.find((s) => !isGiant(s))?.rank ?? null;
  const top3 = snap.slots.slice(0, 3);
  const topLocked = top3.length === 3 && top3.every(isGiant);
  const deadSpace = topLocked || giants >= 7;
  const names = snap.slots.filter(isGiant).slice(0, 3).map((s) => s.host).join(', ');
  return {
    giants,
    firstOpen,
    deadSpace,
    reason: deadSpace
      ? `${giants}/10 slots held by household names (${names})` +
        (firstOpen ? `; best open seat is #${firstOpen}` : '; no open seat')
      : null,
  };
}

/**
 * Stamp grove's difficulty onto a keyword that carries the raw inputs. Pure.
 * `difficulty` is overwritten — every consumer downstream (selection, the
 * cluster gate, the prompt) reads that one field, so this is the only place
 * the provider's KD has to be replaced for all of them to stop trusting it.
 */
export function assess<T extends { difficulty: number | null; providerKd?: number | null; serp?: SerpAuthority | null }>(
  kw: T,
): T & { assessment: Difficulty } {
  const a = groveDifficulty(kw.providerKd ?? null, kw.serp ?? null);
  return { ...kw, difficulty: a.score, assessment: a };
}

/**
 * Fold a slot-by-slot verdict into a keyword's assessment. Pure. Only ever
 * ADDS dead space: a snapshot that looks open does not overrule an average
 * that says giants hold the SERP, because the snapshot can be a year old and
 * the average is refreshed far more often.
 */
export function withSlotVerdict(a: Difficulty, v: SlotVerdict): Difficulty {
  if (!v.deadSpace || a.deadSpace) return a;
  return { ...a, deadSpace: true, reasons: [...a.reasons, v.reason ?? 'household-name SERP'] };
}
