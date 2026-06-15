/**
 * AI-search readiness — turn the validator's content stats into a plain-language
 * score the owner can act on. It answers "how ready is this article to be cited
 * by ChatGPT/Perplexity/AI Overviews and to win featured snippets?" using the
 * signals the GEO research rewards: an extractable TL;DR, a real FAQ, cited
 * evidence, and enough depth.
 *
 * Pure — reads only validation.stats — so it's safe to render anywhere and easy
 * to unit-test. Each check mirrors a rule the writer is told to satisfy.
 */

export type AeoCheck = { label: string; ok: boolean; detail: string };
export type AeoReport = { score: number; grade: 'strong' | 'fair' | 'weak'; checks: AeoCheck[] };

export function scoreAeo(stats: Record<string, number> | null | undefined): AeoReport {
  const s = stats ?? {};
  const n = (k: string) => Number.isFinite(Number(s[k])) ? Number(s[k]) : 0;

  const takeaways = n('key_takeaways_count');
  const faqs = n('faq_count');
  const citations = n('citation_count');
  const words = n('word_count');

  const checks: AeoCheck[] = [
    { label: 'Key takeaways', ok: takeaways >= 3, detail: `${takeaways} bullet${takeaways === 1 ? '' : 's'} · need 3+` },
    { label: 'FAQ section', ok: faqs >= 2, detail: `${faqs} Q&A${faqs === 1 ? '' : 's'} · need 2+` },
    { label: 'Cited evidence', ok: citations >= 2, detail: `${citations} source${citations === 1 ? '' : 's'} · need 2+` },
    { label: 'In-depth', ok: words >= 900, detail: `${words} words · need 900+` },
  ];

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const grade = score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak';
  return { score, grade, checks };
}
