import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getBriefStats, composeBrief, nextAction, type BriefStats } from '@/lib/agent-brief';
import { QualityColumns, type ScoredArticle } from './QualityCharts';
import PipelineActions from './PipelineActions';
import PostRow from './PostRow';
import ModeToggle from './ModeToggle';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(20);

  // Weekly brief — the agent reports outcomes before we show machinery.
  let brief: BriefStats | null = null;
  if (domain) {
    try { brief = await getBriefStats(domain.id, domain.hostname); } catch { /* brief is optional */ }
  }

  // Latest manager evaluation per post → show the quality score in the pipeline.
  const ids = (posts ?? []).map((p) => p.id);
  const scoreByPost = new Map<string, { overall: number; action: string }>();
  if (ids.length) {
    const { data: evals } = await sb
      .from('post_evaluations')
      .select('post_id, scores, action, created_at')
      .in('post_id', ids)
      .order('created_at', { ascending: false });
    for (const e of evals ?? []) {
      if (!scoreByPost.has((e as any).post_id)) {
        scoreByPost.set((e as any).post_id, { overall: (e as any).scores?.overall ?? 0, action: (e as any).action });
      }
    }
  }

  return (
    <>
      {domain && !domain.verified_at && (
        <div style={{ background: 'rgba(89,148,94,0.08)', border: '1px solid var(--moss)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            <b>{domain.hostname}</b> isn't verified yet — autopilot is paused, but you can
            queue topics manually and review every draft.
          </span>
          <Link href={`/onboarding/verify?domain=${domain.id}`} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
            Verify domain →
          </Link>
        </div>
      )}

      {brief && <AgentBrief stats={brief} />}

      <QualityCard posts={posts ?? []} scoreByPost={scoreByPost} />

      <div className="dm-top">
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Content pipeline</h4>
      </div>

      {domain && (
        <ModeToggle
          domainId={domain.id}
          autoPublish={domain.auto_publish ?? false}
          postsPerWeek={domain.posts_per_week ?? 2}
        />
      )}

      <PipelineActions domainId={domain?.id} />

      <p style={{ fontSize: 13, color: 'var(--clay)', marginTop: 12 }}>
        Prefer to write it yourself?{' '}
        <Link href="/dashboard/write" style={{ color: 'var(--moss)', fontWeight: 600 }}>
          Open the writing desk →
        </Link>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
        {(posts ?? []).map((p) => <PostRow key={p.id} p={p} score={scoreByPost.get(p.id) ?? null} />)}
        {(!posts || posts.length === 0) && (
          <p className="lede">No posts yet. Queue a topic above — the pipeline runs immediately.</p>
        )}
      </div>
    </>
  );
}

/* ───────── article quality across the catalog ───────── */

function QualityCard({
  posts, scoreByPost,
}: { posts: any[]; scoreByPost: Map<string, { overall: number; action: string }> }) {
  // oldest → newest so the chart reads left-to-right in time
  const items: ScoredArticle[] = posts
    .filter((p) => scoreByPost.has(p.id))
    .map((p) => ({ id: p.id, title: p.title ?? p.topic, overall: scoreByPost.get(p.id)!.overall }))
    .reverse();
  if (items.length < 2) return null; // a one-bar chart conveys nothing

  const avg = Math.round(items.reduce((a, i) => a + i.overall, 0) / items.length);
  return (
    <section style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px', marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>
          ARTICLE QUALITY · MANAGER SCORES
        </div>
        <span style={{ fontSize: 13, color: 'var(--clay)' }}>
          avg <strong style={{ color: 'var(--ink)', fontFamily: 'Clash Display', fontSize: 16 }}>{avg}</strong>/100
          · {items.length} scored
        </span>
      </div>
      <QualityColumns items={items} />
      <p style={{ fontSize: 12, color: 'var(--clay)', margin: '10px 0 0' }}>
        Every draft is graded 0–100 by the manager agent before it can publish — strategy fit,
        marketing intent, craft, safety. Click a bar to open that article.
      </p>
    </section>
  );
}

/* ───────── the agent's weekly report, in plain language ───────── */

function AgentBrief({ stats }: { stats: BriefStats }) {
  const sentences = composeBrief(stats);
  const action = nextAction(stats);
  const delta = stats.readsLastWeek > 0
    ? Math.round(((stats.readsThisWeek - stats.readsLastWeek) / stats.readsLastWeek) * 100)
    : null;

  return (
    <section style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 24px', marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>
            YOUR MARKETING AGENT · LAST 7 DAYS
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.65, margin: '10px 0 0', maxWidth: 640 }}>
            {sentences.join(' ')}
          </p>
        </div>
        {action && (
          <Link
            href={action.href}
            className="btn btn-primary btn-sm"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {action.label}
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <Chip
          label="Reads"
          value={String(stats.readsThisWeek)}
          sub={delta !== null && Math.abs(delta) >= 5 ? `${delta > 0 ? '+' : ''}${delta}%` : undefined}
          subColor={delta !== null && delta < 0 ? '#b04a3b' : 'var(--moss)'}
        />
        <Chip label="Site clicks" value={String(stats.conversionsThisWeek)} />
        <Chip label="Published" value={`${stats.publishedThisWeek} / ${stats.totalPublished} total`} />
        {stats.organicShare >= 0.05 && (
          <Chip label="From search" value={`${Math.round(stats.organicShare * 100)}%`} />
        )}
        {stats.inReview > 0 && <Chip label="Awaiting review" value={String(stats.inReview)} />}
      </div>
    </section>
  );
}

function Chip({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 14px' }}>
      <span style={{ fontFamily: 'Clash Display', fontSize: 18, color: 'var(--ink)' }}>{value}</span>
      {sub && <span style={{ fontSize: 12, marginLeft: 6, color: subColor ?? 'var(--moss)' }}>{sub}</span>}
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--clay)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
