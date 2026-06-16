/**
 * Plain-language readiness — turn the validator's technical stats + flags into
 * the one thing the owner actually wants to know: is this post ready to bring in
 * visitors? Same underlying analysis as the SEO/AEO machinery; this is just the
 * calm, outcome-first face of it. The raw detail still lives behind a "details"
 * disclosure for anyone who wants it.
 *
 * Pure — reads only its inputs — so it's easy to unit-test.
 */

export type ReadyCheck = { label: string; ok: boolean };
export type Readiness = {
  status: 'ready' | 'almost' | 'draft';
  headline: string;
  checks: ReadyCheck[];
  notes: string[];          // friendly "worth a look" items, already de-jargoned
};

/** Translate a raw validator flag into a plain, action-shaped sentence.
 *  Returns null for nitpicks we don't want to surface up top (they stay in the
 *  raw details). */
export function plainNote(issue: string): string | null {
  const code = issue.split(':')[0].trim();
  const quoted = (issue.match(/"[^"]+"/g) ?? []).join(', ');
  switch (code) {
    case 'SERP_GAP':
      return quoted ? `Top results also cover ${quoted} — worth adding` : 'Cover a subtopic the top results all include';
    case 'MISSING_FAQ':
      return 'Add a short FAQ — it helps AI answers quote you';
    case 'MISSING_KEY_TAKEAWAYS':
      return 'Add a few key takeaways up top';
    case 'THIN_CONTENT':
      return 'A little short — more depth will help it rank';
    case 'LOW_CITATIONS':
      return 'Add a source or two for credibility';
    case 'TITLE_H1_MISMATCH':
    case 'MISSING_H1':
      return 'The headline doesn’t match the title';
    case 'REFERRAL_AWAY':
      return 'Mentions a competitor — worth removing';
    default:
      return null; // wording nitpicks stay in the raw details
  }
}

export function summarizeReadiness(opts: {
  stats?: Record<string, number> | null;
  issues?: string[] | null;
  managerOverall?: number | null;
}): Readiness {
  const s = opts.stats ?? {};
  const n = (k: string) => (Number.isFinite(Number(s[k])) ? Number(s[k]) : 0);
  const words = n('word_count');
  const faq = n('faq_count');
  const takeaways = n('key_takeaways_count');
  const citations = n('citation_count');
  const serpGap = 'serp_gap_count' in s ? n('serp_gap_count') : 0;
  const mgr = opts.managerOverall ?? null;

  const checks: ReadyCheck[] = [
    { label: 'Covers what people are searching', ok: serpGap === 0 && words >= 800 },
    { label: 'Easy for AI to quote', ok: faq >= 2 && takeaways >= 3 },
    { label: 'Backed by real sources', ok: citations >= 2 },
    { label: 'Sounds like you', ok: mgr == null || mgr >= 65 },
  ];

  // The first three are the ones that decide "ready"; voice is shown but soft.
  const hardOk = checks.slice(0, 3).filter((c) => c.ok).length;
  const status: Readiness['status'] = hardOk === 3 ? 'ready' : hardOk >= 1 ? 'almost' : 'draft';
  const headline =
    status === 'ready' ? 'Ready to bring you visitors'
    : status === 'almost' ? 'Almost there — a quick polish'
    : 'Still a rough draft';

  const notes = [...new Set((opts.issues ?? []).map(plainNote).filter((x): x is string => !!x))].slice(0, 3);

  return { status, headline, checks, notes };
}
