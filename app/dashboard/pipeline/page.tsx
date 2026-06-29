import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getBriefStats, composeBrief, nextAction, type BriefStats } from '@/lib/agent-brief';
import PipelineActions from '../PipelineActions';
import PostRow from '../PostRow';
import ModeToggle from '../ModeToggle';
import Icon from '../gv-icons';
import { DashHeader } from '../gv-chrome';

const ACCENT = '#63c281';
const band = (s: number) => (s >= 70 ? ACCENT : s >= 40 ? '#e0c878' : '#c97f7f');

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
  const aeoPct = aeoTotal ? Math.round((aeoReadyCount / aeoTotal) * 100) : 0;

  // quality scores chronological → bars + avg
  const scored = (posts ?? []).filter((p) => scoreByPost.has(p.id)).map((p) => scoreByPost.get(p.id)!.overall).reverse();
  const qAvg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;

  // group the pipeline by stage
  const STUCK_MIN = 3;
  const isStuck = (p: any) => ['queued', 'researching', 'writing'].includes(p.status) && (Date.now() - new Date(p.created_at).getTime()) / 60000 > STUCK_MIN;
  const groupsDef = [
    { key: 'flight', label: 'In flight', color: ACCENT, test: (p: any) => ['queued', 'researching', 'writing'].includes(p.status) && !isStuck(p) },
    { key: 'review', label: 'Needs your review', color: '#e0c878', test: (p: any) => p.status === 'review' },
    { key: 'scheduled', label: 'Scheduled', color: '#9aa096', test: (p: any) => p.status === 'scheduled' },
    { key: 'live', label: 'Published', color: ACCENT, test: (p: any) => p.status === 'published' },
    { key: 'failed', label: 'Needs attention', color: '#c97f7f', test: (p: any) => p.status === 'failed' || isStuck(p) },
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

  const loop = [
    { n: '1', title: 'Strategy', sub: 'A monthly plan — goals, KPIs, content pillars per domain.' },
    { n: '2', title: 'Generation', sub: 'The writer pipeline: research live SERP, draft in your voice.' },
    { n: '3', title: 'Manager', sub: 'Evaluator scores every draft 0–100 and gates publish.' },
    { n: '4', title: 'Analytics', sub: 'First-party events feed next month’s strategy.' },
  ];

  return (
    <>
      <DashHeader title="Content pipeline" subtitle={`${domain?.hostname ?? 'grove.ai'} · the agent loop, running live`} />

      <div className="gv-body">
        {/* live status — relocated out of the nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#565a53' }}>Next publish</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{countdown}</span>
          </div>
        </div>
        {domain && !domain.verified_at && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(224,200,120,0.06)', border: '1px solid rgba(224,200,120,0.24)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 13.5, color: '#d8d2bf' }}>
            <span><b style={{ color: '#eef1ea' }}>{domain.hostname}</b> isn’t verified yet — autopilot is paused, but you can queue topics and review every draft.</span>
            <Link href={`/onboarding/verify?domain=${domain.id}`} className="gv-btn" style={{ whiteSpace: 'nowrap', border: 'none', background: ACCENT, color: '#06120b', fontWeight: 700, fontSize: 13, padding: '9px 15px', borderRadius: 10 }}>Verify domain →</Link>
          </div>
        )}

        {/* agent weekly brief */}
        {brief && (
          <section className="gv-card" style={{ background: 'linear-gradient(135deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.18)', borderRadius: 18, padding: '24px 26px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT }}>
                  <span style={{ display: 'flex' }}><Icon name="leaf" size={13} /></span> Your marketing agent · last 7 days
                </div>
                <p style={{ fontSize: 15.5, lineHeight: 1.62, color: '#dfe4da', margin: '12px 0 0', maxWidth: 660 }}>{composeBrief(brief).join(' ')}</p>
              </div>
              {action && (
                <Link href={action.href} className="gv-btn" style={{ border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '11px 18px', borderRadius: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>{action.label}</Link>
              )}
            </div>
            {chips.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                {chips.map((c, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 11, padding: '9px 15px' }}>
                    <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>{c.value}</span>
                    {c.sub && <span style={{ fontSize: 12, marginLeft: 6, fontWeight: 600, color: ACCENT }}>{c.sub}</span>}
                    <div style={{ fontSize: 9.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#6b6f67', marginTop: 2 }}>{c.label}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* two columns */}
        <div className="gv-pipe-grid" style={{ display: 'grid', gridTemplateColumns: '1.72fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* LEFT */}
          <div>
            <PipelineActions domainId={domain?.id} />
            {domain && <ModeToggle domainId={domain.id} autoPublish={domain.auto_publish ?? false} postsPerWeek={domain.posts_per_week ?? 2} />}

            {groups.map((g) => (
              <div key={g.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 2px 11px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: g.color }} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#cdd2c9' }}>{g.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#565a53', fontVariantNumeric: 'tabular-nums' }}>{g.items.length}</span>
                  <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {g.items.map((p) => <PostRow key={p.id} p={p} score={scoreByPost.get(p.id) ?? null} blogSlug={domain?.blog_slug} />)}
                </div>
              </div>
            ))}

            {groups.length === 0 && (
              <p style={{ color: '#9aa096', marginTop: 24, fontSize: 14 }}>No posts yet. Queue a topic above — the pipeline runs immediately.</p>
            )}
          </div>

          {/* RIGHT RAIL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* article quality */}
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67' }}>Article quality · manager scores</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 12 }}>
                <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{qAvg || '—'}</span>
                <span style={{ fontSize: 12, color: '#9aa096', paddingBottom: 4 }}>avg / 100 · {scored.length} scored</span>
              </div>
              {scored.length >= 2 && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 66, marginTop: 18 }}>
                  {scored.slice(-12).map((s, i) => (
                    <span key={i} title={`${s}/100`} style={{ flex: 1, borderRadius: '4px 4px 0 0', background: band(s), height: `${30 + (s / 100) * 70}%`, opacity: 0.92 }} />
                  ))}
                </div>
              )}
              <p style={{ fontSize: 11.5, color: '#6b6f67', lineHeight: 1.55, margin: '14px 0 0' }}>Every draft is graded 0–100 by the manager agent before it can publish — strategy fit, marketing intent, craft, safety.</p>
            </div>

            {/* AI-search readiness */}
            {aeoTotal >= 2 && (
              <div className="gv-card" style={{ background: 'linear-gradient(150deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.16)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67' }}>AI-search readiness</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
                  <div style={{ position: 'relative', width: 66, height: 66, flexShrink: 0 }}>
                    <svg viewBox="0 0 36 36" style={{ width: 66, height: 66, transform: 'rotate(-90deg)' }}>
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3.4" />
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke={ACCENT} strokeWidth="3.4" strokeLinecap="round" strokeDasharray="97.4" strokeDashoffset={(97.4 * (1 - aeoPct / 100)).toFixed(1)} />
                    </svg>
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{aeoReadyCount}/{aeoTotal}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eef1ea' }}>{aeoPct}% answer-engine ready</div>
                    <div style={{ fontSize: 11.5, color: '#9aa096', lineHeight: 1.5, marginTop: 4 }}>Published posts with FAQ blocks &amp; key-takeaways structured for AI Overviews &amp; ChatGPT.</div>
                  </div>
                </div>
              </div>
            )}

            {/* the agent loop */}
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67', marginBottom: 16 }}>The agent loop</div>
              {loop.map((l, i) => (
                <div key={l.n} style={{ display: 'flex', gap: 13, paddingBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(99,194,129,0.1)', border: '1px solid rgba(99,194,129,0.25)', color: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{l.n}</span>
                    {i < loop.length - 1 && <span style={{ flex: 1, width: 1, minHeight: 16, background: 'rgba(99,194,129,0.18)', marginTop: 4 }} />}
                  </div>
                  <div style={{ marginTop: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{l.title}</div>
                    <div style={{ fontSize: 11.5, color: '#6b6f67', marginTop: 2, lineHeight: 1.45 }}>{l.sub}</div>
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#565a53', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ color: ACCENT }}>↻</span> Strategy re-reviewed on the 1st of each month</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
