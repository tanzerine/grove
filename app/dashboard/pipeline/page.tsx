import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getBriefStats, composeBrief, nextAction, type BriefStats } from '@/lib/agent-brief';
import PipelineActions from '../PipelineActions';
import PostRow from '../PostRow';
import ModeToggle from '../ModeToggle';
import Icon from '../gv-icons';
import { DashHeader } from '../gv-chrome';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(40);

  let brief: BriefStats | null = null;
  if (domain) { try { brief = await getBriefStats(domain.id, domain.hostname); } catch { /* optional */ } }

  // latest manager evaluation per post
  const ids = (posts ?? []).map((p) => p.id);
  const scoreByPost = new Map<string, { overall: number; action: string }>();
  if (ids.length) {
    const { data: evals } = await sb
      .from('post_evaluations').select('post_id, scores, action, created_at')
      .in('post_id', ids).order('created_at', { ascending: false });
    for (const e of evals ?? []) {
      if (!scoreByPost.has((e as any).post_id)) {
        scoreByPost.set((e as any).post_id, { overall: (e as any).scores?.overall ?? 0, action: (e as any).action });
      }
    }
  }

  const publishedPosts = (posts ?? []).filter((p) => p.status === 'published');
  const aeoReadyCount = publishedPosts.filter((p) => {
    const s = (p.validation as any)?.stats;
    return s && (s.faq_count ?? 0) >= 2 && (s.key_takeaways_count ?? 0) >= 3;
  }).length;
  const aeoTotal = publishedPosts.length;

  // group the pipeline by stage
  const STUCK_MIN = 3;
  const isStuck = (p: any) => ['queued', 'researching', 'writing'].includes(p.status) && (Date.now() - new Date(p.created_at).getTime()) / 60000 > STUCK_MIN;
  const groupsDef = [
    { key: 'flight', label: 'In flight', color: ACCENT_INK, test: (p: any) => ['queued', 'researching', 'writing'].includes(p.status) && !isStuck(p) },
    { key: 'review', label: 'Needs your review', color: 'var(--gv-amber)', test: (p: any) => p.status === 'review' },
    { key: 'scheduled', label: 'Scheduled', color: 'var(--gv-dim)', test: (p: any) => p.status === 'scheduled' },
    { key: 'live', label: 'Published', color: ACCENT_INK, test: (p: any) => p.status === 'published' },
    { key: 'failed', label: 'Needs attention', color: 'var(--gv-red)', test: (p: any) => p.status === 'failed' || isStuck(p) },
  ];
  const groups = groupsDef.map((g) => ({ ...g, items: (posts ?? []).filter(g.test) })).filter((g) => g.items.length);

  // next-publish countdown from the soonest scheduled post
  const nextSched = (posts ?? []).filter((p) => p.status === 'scheduled' && p.scheduled_at)
    .map((p) => new Date(p.scheduled_at).getTime()).filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
  let countdown = '—';
  if (nextSched) {
    const mins = Math.round((nextSched - Date.now()) / 60000);
    countdown = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
  }

  const action = brief ? nextAction(brief) : null;
  const delta = brief && brief.readsLastWeek > 0 ? Math.round(((brief.readsThisWeek - brief.readsLastWeek) / brief.readsLastWeek) * 100) : null;

  const chips: { value: string; sub?: string; label: string }[] = brief ? [
    { value: String(brief.readsThisWeek), sub: delta !== null && Math.abs(delta) >= 5 ? `${delta > 0 ? '+' : ''}${delta}%` : undefined, label: 'Reads' },
    { value: String(brief.conversionsThisWeek), label: 'Site clicks' },
    { value: `${brief.publishedThisWeek} / ${brief.totalPublished}`, label: 'Published' },
    ...(brief.organicShare >= 0.05 ? [{ value: `${Math.round(brief.organicShare * 100)}%`, label: 'From search' }] : []),
    ...(aeoTotal >= 2 ? [{ value: `${aeoReadyCount} / ${aeoTotal}`, label: 'AI-search ready' }] : []),
    ...(brief.inReview > 0 ? [{ value: String(brief.inReview), label: 'Awaiting review' }] : []),
  ] : [];

  const inFlightCount = groups.find((g) => g.key === 'flight')?.items.length ?? 0;
  const reviewCount = groups.find((g) => g.key === 'review')?.items.length ?? 0;
  const statusBits = [
    inFlightCount > 0 ? `${inFlightCount} in progress` : null,
    reviewCount > 0 ? `${reviewCount} waiting on you` : null,
  ].filter(Boolean);
  const subtitle = statusBits.length
    ? `${domain?.hostname ?? 'grove.ai'} · ${statusBits.join(' · ')}`
    : `${domain?.hostname ?? 'grove.ai'} · the agent loop, running live`;

  return (
    <>
      <DashHeader title="Content pipeline" subtitle={subtitle} />

      {/* The comp runs one 1180px column, centred — every band (brief, queue,
          pipeline rows, stats) shares it, so nothing steps out of line. */}
      <div className="gv-body" style={{ maxWidth: 1180 }}>
        {/* live status — relocated out of the nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Next publish</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT_INK }}>{countdown}</span>
          </div>
        </div>
        {domain && !domain.verified_at && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 13.5, color: '#d8d2bf' }}>
            <span><b style={{ color: 'var(--gv-ink)' }}>{domain.hostname}</b> isn’t verified yet — autopilot is paused, but you can queue topics and review every draft.</span>
            <Link href={`/onboarding/verify?domain=${domain.id}`} className="gv-btn" style={{ whiteSpace: 'nowrap', border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontWeight: 700, fontSize: 13, padding: '9px 15px', borderRadius: 10 }}>Verify domain →</Link>
          </div>
        )}

        {/* agent weekly brief */}
        {brief && (
          <section className="gv-card" style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(162,255,1,0.18)', borderRadius: 18, padding: '24px 26px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT_INK }}>
                  <span style={{ display: 'flex' }}><Icon name="leaf" size={13} /></span> Your marketing agent · last 7 days
                </div>
                <p style={{ fontSize: 15.5, lineHeight: 1.62, color: 'var(--gv-soft)', margin: '12px 0 0', maxWidth: 660 }}>{composeBrief(brief).join(' ')}</p>
              </div>
              {action && (
                <Link href={action.href} className="gv-btn" style={{ border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '11px 18px', borderRadius: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>{action.label}</Link>
              )}
            </div>
            {chips.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                {chips.map((c, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid var(--gv-line)', borderRadius: 11, padding: '9px 15px' }}>
                    <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>{c.value}</span>
                    {c.sub && <span style={{ fontSize: 12, marginLeft: 6, fontWeight: 600, color: ACCENT_INK }}>{c.sub}</span>}
                    <div style={{ fontSize: 9.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginTop: 2 }}>{c.label}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* QUEUE TOPIC + PUBLISHING SETTINGS — single column, matching the pipeline comp */}
        <div>
          <PipelineActions domainId={domain?.id} />
          {domain && <ModeToggle domainId={domain.id} autoPublish={domain.auto_publish ?? false} postsPerWeek={domain.posts_per_week ?? 2} autoPublishFloor={domain.auto_publish_floor ?? 45} />}

          {/* PIPELINE — grouped rows: in flight / needs review / scheduled / published / needs attention */}
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 2px 11px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: g.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-soft)' }}>{g.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gv-fainter)', fontVariantNumeric: 'tabular-nums' }}>{g.items.length}</span>
                <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              </div>
              {g.key === 'review' && <ReviewWhy autoPublish={domain?.auto_publish ?? false} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {g.items.map((p) => <PostRow key={p.id} p={p} score={scoreByPost.get(p.id) ?? null} blogSlug={domain?.blog_slug} />)}
              </div>
            </div>
          ))}

          {groups.length === 0 && (
            <p style={{ color: 'var(--gv-dim)', marginTop: 24, fontSize: 14 }}>No posts yet. Queue a topic above — the pipeline runs immediately.</p>
          )}
        </div>

      </div>
    </>
  );
}

/**
 * Inline "why is this waiting for you?" explainer for the review group. A draft
 * only publishes on its own when BOTH gates pass — this spells out which one is
 * holding these, and the copy adapts to whether Autopilot is on. Native
 * <details> so it works in a server component with no client JS.
 */
function ReviewWhy({ autoPublish }: { autoPublish: boolean }) {
  const li: React.CSSProperties = { fontSize: 12, color: 'var(--gv-faint)', lineHeight: 1.55, margin: '0 0 6px' };
  const strong: React.CSSProperties = { color: 'var(--gv-soft)', fontWeight: 600 };
  return (
    <details style={{ margin: '-2px 2px 12px' }}>
      <summary style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11.5, color: 'var(--gv-dim)', listStyle: 'none', userSelect: 'none', width: 'fit-content' }}>
        <Icon name="q" size={13} /> Why is this waiting for you?
      </summary>
      <div style={{ marginTop: 9, padding: '13px 15px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, maxWidth: 560 }}>
        <div style={{ fontSize: 11.5, color: 'var(--gv-soft)', fontWeight: 600, marginBottom: 8 }}>
          A draft publishes on its own only when both gates pass:
        </div>
        {autoPublish ? (
          <>
            <p style={li}>
              <span style={strong}>1 · Autopilot — on.</span> Clean drafts publish themselves, so these were
              held by the second gate.
            </p>
            <p style={li}>
              <span style={strong}>2 · Something was actually wrong.</span> Autopilot ships unless a draft is rejected as
              off-strategy, trips a fatal check (fabricated stats, thin or structurally broken content, or links that
              send readers to a competitor), or scores far too low. Approve to publish anyway, or Regenerate to rewrite.
            </p>
          </>
        ) : (
          <>
            <p style={li}>
              <span style={strong}>1 · Autopilot — off.</span> Every finished draft waits here for your approval,
              whatever it scores. Turn on Autopilot above to let clean drafts publish themselves.
            </p>
            <p style={li}>
              <span style={strong}>2 · Fatal-issue gate.</span> Even on Autopilot, a draft is still held when something&apos;s
              actually wrong — the manager rejects it as off-strategy, it trips a fatal check (fabricated stats, thin or
              broken content, links that send readers away), or it scores far too low.
            </p>
          </>
        )}
        <p style={{ ...li, margin: 0, color: 'var(--gv-fainter)' }}>
          An <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>ungraded</span> or{' '}
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>grading&nbsp;failed</span> tag means the
          quality check didn&apos;t finish for that draft — the draft is kept and held for you. Use{' '}
          <span style={strong}>Re-run check</span> to grade it (it re-scores the same draft, no rewrite).
        </p>
      </div>
    </details>
  );
}
