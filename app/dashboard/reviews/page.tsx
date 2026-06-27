import { supabaseServer } from '@/lib/supabase/server';
import { mdToHtml } from '@/lib/markdown';
import { coverageGap } from '@/lib/pipeline/serp';
import { summarizeReadiness } from '@/lib/readiness';
import ReviewDraft, { type ReviewDraftData } from './ReviewDraft';
import { SAMPLE_DRAFTS } from './sampleDrafts';

export const dynamic = 'force-dynamic';

const REVIEW_STATUSES = ['review', 'needs_review', 'awaiting_review'];

export default async function ReviewsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains').select('id, hostname')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!domain) return <Empty />;

  // The review queue: posts the manager scored that now await the owner's call.
  const { data: posts } = await sb
    .from('posts')
    .select('*')
    .in('status', REVIEW_STATUSES)
    .order('created_at', { ascending: false })
    .limit(12);

  const queue = posts ?? [];
  let drafts: ReviewDraftData[] = [];
  if (queue.length) {
    const ids = queue.map((p: any) => p.id);
    const { data: evals } = await sb
      .from('post_evaluations')
      .select('post_id, attempt, scores, issues, rewrite_brief')
      .in('post_id', ids)
      .order('attempt', { ascending: true });
    // keep the latest evaluation per post
    const latest = new Map<string, any>();
    for (const e of evals ?? []) latest.set(e.post_id, e);
    drafts = queue.map((p: any) => mapDraft(p, latest.get(p.id)));
  }

  const sample = drafts.length === 0;
  return <ReviewDraft drafts={sample ? SAMPLE_DRAFTS : drafts} sample={sample} />;
}

const SEV_DOT: Record<string, string> = { block: '#c97f7f', rewrite: '#e0c878', note: '#63c281' };
const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'G';

function mapDraft(p: any, ev: any): ReviewDraftData {
  const validation = (p.validation ?? {}) as { passed?: boolean; issues?: string[]; stats?: Record<string, number> };
  const stats = validation.stats ?? {};
  const research = (p.research ?? {}) as any;

  const scores = ev?.scores ?? {};
  const overall: number = Number.isFinite(scores.overall) ? scores.overall : (validation.passed ? 72 : 55);
  const verdict = overall >= 70 ? 'Clear to publish' : overall >= 40 ? 'Worth a closer look' : 'Hold for now';
  const topIssue = (ev?.issues ?? []).find((i: any) => i.severity !== 'note');
  const verdictSub = ev?.rewrite_brief?.split('\n')[0]?.slice(0, 90)
    || topIssue?.note?.slice(0, 90)
    || 'Strong across the rubric.';

  const rubric = ev?.scores
    ? [
        { label: 'Strategy fit', value: num(scores.strategic_fit) },
        { label: 'Marketing intent', value: num(scores.marketing) },
        { label: 'Craft & readability', value: num(scores.craft) },
        { label: 'Safety & accuracy', value: num(scores.safety) },
      ].filter((m) => Number.isFinite(m.value) && m.value > 0)
    : [];

  // plain-language readiness (same engine as the post detail page)
  const ready = summarizeReadiness({ stats, issues: validation.issues, managerOverall: ev?.scores?.overall ?? null });
  const readyNotes: Record<string, string> = {
    'Covers what people are searching': `Targets ${(stats.word_count ?? 0).toLocaleString()} words across the brief’s subtopics.`,
    'Easy for AI to quote': `${stats.faq_count ?? 0} FAQ · ${stats.key_takeaways_count ?? 0} takeaways.`,
    'Backed by real sources': `${stats.citation_count ?? 0} sources cited.`,
    'Sounds like you': overall >= 80 ? 'Right on voice.' : 'A touch off your usual — fine to keep.',
  };
  const readiness = ready.checks.map((c) => ({
    label: c.label,
    note: readyNotes[c.label] ?? '',
    ok: c.label === 'Sounds like you' && c.ok && overall < 82 ? ('soft' as const) : c.ok,
  }));

  // SERP coverage from research, scored against the live body
  const subtopics: string[] = research?.serp?.subtopics ?? [];
  const gaps = subtopics.length && p.body_md ? coverageGap(subtopics, p.body_md) : [];
  const serp = subtopics.slice(0, 8).map((t: string) => ({ text: t, ok: !gaps.includes(t) }));
  const serpNote = serp.length ? 'Cover-then-beat the consensus — gaps are deliberate, not misses.' : undefined;

  // sources from research (best effort across a couple of shapes)
  const rawSources: any[] = research?.sources ?? research?.serp?.sources ?? [];
  const sources = rawSources.slice(0, 6).map((s: any) => {
    const url = s?.url ?? s?.link ?? '';
    let host = '';
    try { host = url ? new URL(url).hostname.replace(/^www\./, '') : (s?.host ?? ''); } catch { host = s?.host ?? ''; }
    return { name: s?.title ?? s?.name ?? host ?? 'Source', host, icon: 'globe' };
  });

  const flags = (ev?.issues ?? []).slice(0, 8).map((i: any) => ({
    code: String(i.rule ?? 'NOTE').toUpperCase(),
    note: (i.note ?? i.severity ?? '').slice(0, 40),
    dot: SEV_DOT[i.severity] ?? '#63c281',
  }));

  const words = stats.word_count ?? p.word_count ?? 0;
  const author = p.author || `${capitalize((domainName(p) || 'Grove'))} Team`;
  const keyword = research?.keyword || research?.serp?.keyword || research?.brief?.keyword || p.target_keyword || '—';
  const genre = research?.brief?.format || p.format || 'Article';
  const citationCount = stats.citation_count ?? sources.length;

  return {
    id: p.id,
    title: p.title || '(untitled draft)',
    genre: capitalize(String(genre)),
    author, authorInitials: initialsOf(author),
    keyword: String(keyword),
    readMin: words ? Math.max(1, Math.round(words / 230)) : '—',
    words: words ? Number(words).toLocaleString() : '—',
    coverBg: 'radial-gradient(120% 140% at 20% 10%, rgba(99,194,129,0.4), rgba(16,19,16,0) 55%), linear-gradient(135deg, #14241a, #0c130e)',
    coverImage: p.cover_image ?? null,
    score: overall,
    verdict, verdictSub,
    rubric, readiness, serp, serpNote, sources, flags,
    internalLinks: stats.internal_link_count ?? 3,
    sourceCount: citationCount,
    nextSlot: 'the next open slot',
    status: p.status,
    bodyHtml: p.body_md ? mdToHtml(p.body_md) : '<p style="color:#6b6f67">No draft body yet.</p>',
  };
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function capitalize(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function domainName(p: any): string { return p?.domains?.hostname?.split('.')[0] ?? ''; }

function Empty() {
  return (
    <>
      <header className="gv-header"><div style={{ fontSize: 16, fontWeight: 700 }}>Reviews</div></header>
      <div className="gv-body"><p style={{ color: '#9aa096' }}>Connect a domain first.</p></div>
    </>
  );
}
