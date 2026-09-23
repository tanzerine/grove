/**
 * What DataForSEO says about WHO holds a keyword's top 10 — recorded, and
 * deliberately NOT used to choose keywords.
 *
 * ── The hypothesis, and how it failed ──────────────────────────────────────
 * #294 (2026-09-23) built a "grove difficulty" = max(provider KD, an
 * authority wall from the top 10's average domain rank) plus a dead-space
 * veto for household-name SERPs, on five keywords where KD 0 looked like a
 * trap. The same day it was graded against oveners.com's whole Search
 * Console history — 171 non-branded queries, 67 of them known to Labs
 * (scripts/difficulty-calibration.ts) — and it failed on the data it was
 * meant to fix:
 *
 *   predicting "reached the top 20" (AUC, 0.5 = chance, 90% bootstrap CI)
 *     provider KD        0.61  [0.50, 0.73]
 *     avg domain rank    0.31  [0.21, 0.43]   ← significantly the WRONG way
 *     grove difficulty   0.40  [0.29, 0.51]   ← worse than KD alone
 *
 * The mechanism is visible row by row. On oveners the giant-domain SERPs are
 * "how to do X in Photoshop / Procreate / Illustrator": Adobe's docs and
 * YouTube hold them, and a specific tutorial gets in at 7-10. The low-domain-
 * rank SERPs are TOOL SERPs ("auto background remover", domain rank 427,
 * KD 100) full of well-linked tool homepages, where oveners sits at 40-68.
 * KD sees those links; domain rank does not. And the dead-space veto would
 * have rejected two of the three measured queries that earned clicks at all
 * ("how to automatically remove background in procreate", 10 clicks, and
 * the Photoshop variant, 6) — the only support for it was the Illustrator
 * cluster, zero clicks from ~400 impressions.
 *
 * So selection is back on KD, and this module keeps only the parsers: the
 * authority fields ride along on each keyword (`ScoredKeyword.serp`, free —
 * same response) and the calibration script re-grades any successor
 * hypothesis against them. Caveats that cut both ways: one domain; Search
 * Console is censored to queries the site already appears for; three
 * click-earning rows is not a click model. Re-run the script before
 * reintroducing any of this, and on more than one domain.
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
 * Where the calibration drew the household-name line: youtube 1000, adobe
 * 842, reddit 818, canva 694. A measurement convention for slotVerdict, not
 * a threshold anything is rejected on.
 */
export const GIANT_DOMAIN_RANK = 650;

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

// ── per slot: who holds each of the ten ───────────────────────────────────

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
 * Dead space, slot by slot, as the #294 hypothesis defined it. Pure. Kept so
 * the calibration can keep grading it — see the header for why nothing acts
 * on it.
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
