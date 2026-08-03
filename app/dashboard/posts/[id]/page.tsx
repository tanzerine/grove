import { supabaseServer } from '@/lib/supabase/server';
import { mdToHtml } from '@/lib/markdown';
import { stripLeadingH1 } from '@/lib/article-body';
import { notFound } from 'next/navigation';
import PostActions from './PostActions';
import PipelineTimeline from './PipelineTimeline';
import RichEditor from './RichEditor';
import SocialComposer, { type ComposerPlatform } from './SocialComposer';
import ProcessDrawer from './ProcessDrawer';
import LocalTime from '../../LocalTime';
import Link from 'next/link';
import { ScoreRing, RubricBars, bandColor, type RubricScores } from '../../QualityCharts';
import { scoreAeo } from '@/lib/aeo-score';
import { coverageGap } from '@/lib/pipeline/serp';
import { summarizeReadiness, type Readiness } from '@/lib/readiness';
import Icon from '../../gv-icons';
import { DashHeader } from '../../gv-chrome';
import { PLATFORMS } from '@/lib/social/providers';
import { blogPostUrl, canonicalBaseFor } from '@/lib/seo';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: p } = await sb.from('posts').select('*, domains(id,blog_slug,hostname,auto_social,social_webhook_url,canonical_blog_base,custom_blog_hostname)').eq('id', id).single();
  if (!p) notFound();
  const domain = (p as any).domains;

  const { data: conns } = domain
    ? await sb.from('social_connections').select('platform, account_handle').eq('domain_id', domain.id)
    : { data: [] };
  const connByPlatform = new Map((conns ?? []).map((c: any) => [c.platform, c]));
  const composerPlatforms: ComposerPlatform[] = PLATFORMS.map((pf) => ({
    id: pf,
    handle: connByPlatform.get(pf)?.account_handle ?? null,
    connected: connByPlatform.has(pf),
  }));

  const { data: evals } = await sb
    .from('post_evaluations')
    .select('attempt, action, scores, issues, created_at')
    .eq('post_id', id)
    .order('attempt', { ascending: true });

  const social = (p.social ?? {}) as { x?: string; linkedin?: string; disabled?: string[] };
  const validation = p.validation as { passed?: boolean; issues?: string[]; stats?: Record<string, number>; error?: string } | null;
  // The canvas renders the title itself, so drop the body's own leading H1.
  const bodyHtml = p.body_md ? mdToHtml(stripLeadingH1(p.body_md)) : '';

  const hasInlineImages = (() => {
    if (!p.body_md) return false;
    const lines = p.body_md.split('\n');
    let pastH2 = false; let count = 0;
    for (const l of lines) {
      if (/^##\s/.test(l)) pastH2 = true;
      if (pastH2 && /^!\[.+\]\(.+\)/.test(l.trim())) count++;
    }
    return count >= 2;
  })();

  const managerOverall = evals && evals.length ? ((evals[evals.length - 1] as any)?.scores?.overall ?? null) : null;
  // Published posts already cleared the gate — only surface the "sent back"
  // framing while the draft is actually held.
  const managerAction = p.status !== 'published' && evals && evals.length
    ? ((evals[evals.length - 1] as any)?.action ?? null) : null;
  const readiness: Readiness | null = validation?.stats && p.body_md
    ? summarizeReadiness({ stats: validation.stats, issues: validation.issues, managerOverall, managerAction }) : null;

  const stats = validation?.stats ?? {};
  const words = stats.word_count ?? null;
  const cites = stats.citation_count ?? 0;
  const readMin = words ? Math.max(1, Math.round(words / 230)) : null;
  const research = (p.research as any) ?? {};
  const serp = research?.serp;
  const hasSerp = !!serp?.subtopics?.length && !!p.body_md;
  const rawSources: any[] = research?.sources ?? research?.serp?.sources ?? [];
  const sources = rawSources.slice(0, 6).map((s: any) => {
    const url = s?.url ?? s?.link ?? '';
    let host = '';
    try { host = url ? new URL(url).hostname.replace(/^www\./, '') : (s?.host ?? ''); } catch { host = s?.host ?? ''; }
    return { name: s?.title ?? s?.name ?? host ?? 'Source', host, icon: 'globe' };
  });

  const latestEval = evals && evals.length ? (evals[evals.length - 1] as any) : null;
  const hasBlockingIssues = !!latestEval?.issues?.some((i: any) => i.severity !== 'note');
  const unusual = (managerOverall !== null && managerOverall < 70) || hasBlockingIssues || !!(readiness && readiness.checks.some((c) => !c.ok));

  const statusMeta: Record<string, { label: string; color: string; bg: string; border: string }> = {
    review: { label: 'In review', color: 'var(--gv-amber)', bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.24)' },
    scheduled: { label: 'Scheduled', color: 'var(--gv-sky)', bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.24)' },
    published: { label: 'Live', color: ACCENT_INK, bg: 'rgba(162,255,1,0.08)', border: 'rgba(162,255,1,0.24)' },
    failed: { label: 'Failed', color: 'var(--gv-red)', bg: 'rgba(201,127,127,0.08)', border: 'rgba(201,127,127,0.24)' },
  };
  const sm = statusMeta[p.status] ?? { label: p.status, color: 'var(--gv-dim)', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.1)' };
  const editable = ['review', 'scheduled', 'published'].includes(p.status);

  return (
    <>
      <DashHeader left={
        <>
          <Link href="/dashboard/pipeline" className="gv-back" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', color: 'var(--gv-dim)', fontSize: 13, fontWeight: 600 }}>
            <span style={{ display: 'flex' }}><Icon name="back" size={16} /></span> Pipeline
          </Link>
          <span style={{ color: '#3a4640' }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--gv-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>Reviewing draft</span>
        </>
      } />

      <div className="gv-body" style={{ maxWidth: 1440 }}>
        {/* article header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: sm.color, background: sm.bg, border: `1px solid ${sm.border}`, padding: '5px 12px', borderRadius: 999 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.color, animation: 'gvPulse 2.2s ease-in-out infinite' }} />{sm.label}
          </span>
          {managerOverall !== null && (
            <span title="Manager quality score" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontVariantNumeric: 'tabular-nums', border: `1px solid color-mix(in srgb, ${bandColor(Number(managerOverall))} 30%, transparent)`, borderRadius: 999, padding: '4px 11px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: bandColor(Number(managerOverall)) }}>{managerOverall}</span>
              <span style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gv-faint)' }}>score</span>
            </span>
          )}
          {p.topic && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--gv-dim)' }}>
              <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="target" size={13} /></span> Target · <span style={{ color: 'var(--gv-soft)', fontWeight: 600 }}>{p.topic}</span>
            </span>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--gv-fainter)' }}>
            {words ? `·  ${words.toLocaleString()} words  ` : ''}{cites ? `·  ${cites} citations  ` : ''}{readMin ? `·  ${readMin} min read` : ''}
          </span>
          {p.scheduled_at && (
            /* `scheduled` is the only status the publisher cron acts on. On any
               other, this date is the strategy slot's target the draft was
               written for — worth showing, but it publishes nothing on its own,
               and saying "Publishes" over both is how an approval queue came to
               look like an autopilot that had stopped working. */
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>
                {p.status === 'scheduled' ? 'Publishes' : 'Planned for'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: p.status === 'scheduled' ? ACCENT_INK : 'var(--gv-soft)' }}>
                <LocalTime iso={p.scheduled_at} />
              </span>
              {p.status !== 'scheduled' && p.status !== 'published' && (
                <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>won’t publish until approved</span>
              )}
            </div>
          )}
        </div>
        <PostActions
          id={p.id}
          status={p.status}
          published={p.status === 'published'}
          /* Where the article actually lives for a READER — which is the
             customer's own base whenever they have one (canonical_blog_base, or
             a custom_blog_hostname grove serves). Hand-building /b/{slug} here
             sent "View live" to the grove-hosted mirror while every other
             surface — embed API, rel=canonical, sitemap, RSS, social — pointed
             at the customer's domain. */
          publicUrl={p.status === 'published' && domain?.blog_slug && p.slug
            ? blogPostUrl(domain.blog_slug, p.slug, canonicalBaseFor(domain))
            : null}
          hasCover={!!p.cover_image_url}
          hasInlineImages={hasInlineImages}
        >
          {editable && (
            <ProcessDrawer unusual={unusual}>
              {readiness && <ReadinessCard r={readiness} />}
              {evals && evals.length > 0 && <ManagerCard evals={evals as any} />}
              {validation?.stats && p.body_md && <AeoCard report={scoreAeo(validation.stats)} />}
              {hasSerp && <SerpCard subtopics={serp.subtopics as string[]} body={p.body_md!} />}
              {sources.length > 0 && <SourcesCard sources={sources} />}
              <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 14 }}>Pipeline timeline</div>
                <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
              </div>
            </ProcessDrawer>
          )}
        </PostActions>

        {p.status === 'failed' && (
          <div style={{ background: 'rgba(201,127,127,0.08)', border: '1px solid rgba(201,127,127,0.3)', color: 'var(--gv-red-soft)', padding: 18, borderRadius: 12, marginTop: 20 }}>
            <b>Generation failed.</b>
            <div style={{ fontSize: 12, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{validation?.error ?? 'Unknown error'}</div>
          </div>
        )}

        {editable ? (
          /* ===== comp-style editor (canvas + grove assist rail) + review row below ===== */
          <>
            <div style={{ marginTop: 20 }}>
              <RichEditor
                postId={p.id}
                domainId={domain?.id}
                initialBody={p.body_md ?? ''}
                initialTitle={p.title ?? ''}
                initialMetaTitle={p.meta_title ?? ''}
                initialMetaDesc={p.meta_description ?? ''}
                canEdit
                initialScheduledAt={p.status === 'published' ? null : p.scheduled_at}
                initialWillPublish={p.status === 'scheduled'}
                schedulable={p.status !== 'published'}
                autoEdit={!p.body_md}
                belowCanvas={
                  <SocialComposer
                    postId={p.id}
                    domainId={domain?.id ?? ''}
                    published={p.status === 'published'}
                    social={social}
                    socialPublished={(p.social_published ?? {}) as Record<string, any>}
                    platforms={composerPlatforms}
                    autoShare={!!domain?.auto_social}
                    hasWebhook={!!domain?.social_webhook_url}
                  />
                }
              />
            </div>
          </>
        ) : (
          /* ===== not yet editable: reading surface + review rail ===== */
          <div className="gv-2col-rail" style={{ display: 'grid', gridTemplateColumns: '1fr 372px', gap: 22, alignItems: 'start', marginTop: 22 }}>
            <div className="gv-canvas-prose" style={{ background: '#0e110d', border: '1px solid var(--gv-line)', borderRadius: 18, overflow: 'hidden' }}>
              {p.body_md && bodyHtml ? (
                <div className="article-surface">
                  <h1 className="gv-canvas-title">{p.title ?? p.topic ?? '(no title)'}</h1>
                  <article className="prose" style={{ maxWidth: 'none' }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                </div>
              ) : (
                <div className="article-surface" style={{ color: 'var(--gv-faint)' }}>
                  <h1 className="gv-canvas-title" style={{ fontSize: 27 }}>{p.title ?? p.topic ?? 'Writing…'}</h1>
                  <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
                </div>
              )}
            </div>
            <div className="gv-rail" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 78 }}>
              {readiness && <ReadinessCard r={readiness} />}
              {evals && evals.length > 0 && <ManagerCard evals={evals as any} />}
              {validation?.stats && p.body_md && <AeoCard report={scoreAeo(validation.stats)} />}
              {hasSerp && <SerpCard subtopics={serp.subtopics as string[]} body={p.body_md!} />}
              <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 14 }}>Pipeline timeline</div>
                <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- dark rail cards ---------- */

function card(extra: React.CSSProperties = {}): React.CSSProperties {
  return { background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px', ...extra };
}

function ReadinessCard({ r }: { r: Readiness }) {
  return (
    <div className="gv-card" style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(162,255,1,0.2)', borderRadius: 18, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(162,255,1,0.14)', border: '1px solid rgba(162,255,1,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT_INK, flexShrink: 0 }}><Icon name="check" size={16} /></span>
        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 500, color: 'var(--gv-ink)', lineHeight: 1.2 }}>{r.headline}</div>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '13px 0 15px' }}>Built to rank on Google and get quoted by AI — written in your voice.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {r.checks.map((c) => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ color: c.ok ? ACCENT_INK : 'var(--gv-faint)', display: 'flex' }}>{c.ok ? <Icon name="check" size={15} /> : <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--gv-fainter)', display: 'inline-block' }} />}</span>
            <span style={{ color: c.ok ? 'var(--gv-soft)' : 'var(--gv-faint)' }}>{c.label}</span>
          </div>
        ))}
      </div>
      {r.notes.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 7 }}>Worth a look</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--gv-soft)', lineHeight: 1.65 }}>
            {r.notes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

type EvalIssue = { rule?: string; severity: string; note?: string };
type EvalRow = { attempt: number; action: string; scores: RubricScores | null; issues: EvalIssue[] | null; created_at: string };
const SEV_DOT: Record<string, string> = { block: 'var(--gv-red)', rewrite: 'var(--gv-amber)', note: 'var(--gv-accent)' };

function ManagerCard({ evals }: { evals: EvalRow[] }) {
  const latest = evals[evals.length - 1];
  const overall = Number(latest.scores?.overall ?? 0);
  const actionLabel: Record<string, { text: string; color: string }> = {
    approve: { text: 'Approved by the manager agent', color: ACCENT_INK },
    rewrite: { text: 'Sent back for rewrite', color: 'var(--gv-amber)' },
    reject: { text: 'Rejected — routed to your review', color: 'var(--gv-red)' },
  };
  const act = actionLabel[latest.action] ?? { text: latest.action, color: 'var(--gv-dim)' };
  const issues = latest.issues ?? [];
  return (
    <div className="gv-card" style={card()}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 16 }}>Manager score · attempt {latest.attempt}/2</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <ScoreRing value={overall} />
        <RubricBars scores={latest.scores} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: act.color, marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 13 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: act.color }} />{act.text}
      </div>
      {issues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 13, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {issues.slice(0, 6).map((i, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: SEV_DOT[i.severity] ?? ACCENT, flexShrink: 0 }} />
              <span style={{ color: 'var(--gv-dim)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}>{String(i.rule ?? 'NOTE').toUpperCase()}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--gv-fainter)', fontSize: 11 }}>{(i.note ?? '').slice(0, 60)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AeoCard({ report }: { report: ReturnType<typeof scoreAeo> }) {
  return (
    <div className="gv-card" style={card()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)' }}>AI-search readiness</span>
        <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, color: bandColor(report.score) }}>{report.score}<span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>/100</span></span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {report.checks.map((c) => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
            <span style={{ color: c.ok ? ACCENT_INK : 'var(--gv-fainter)', display: 'flex', flexShrink: 0 }}>{c.ok ? <Icon name="check" size={14} /> : <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--gv-fainter)', display: 'inline-block' }} />}</span>
            <span style={{ color: c.ok ? 'var(--gv-soft)' : 'var(--gv-faint)', flex: 1 }}>{c.label}</span>
            <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)', fontFamily: 'ui-monospace, monospace' }}>{c.detail}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--gv-fainter)', lineHeight: 1.5, margin: '14px 0 0' }}>How ready this article is to be quoted by ChatGPT, Perplexity &amp; Google AI Overviews.</p>
    </div>
  );
}

function SerpCard({ subtopics, body }: { subtopics: string[]; body: string }) {
  const missing = new Set(coverageGap(subtopics, body, 99).map((s) => s.toLowerCase()));
  return (
    <div className="gv-card" style={card()}>
      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)' }}>What&apos;s ranking for this topic</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {subtopics.map((s) => {
          const gap = missing.has(s.toLowerCase());
          return (
            <span key={s} className="gv-chip" style={{ fontSize: 12, padding: '5px 11px', borderRadius: 999, background: gap ? 'rgba(201,127,127,0.08)' : 'rgba(162,255,1,0.08)', color: gap ? 'var(--gv-red-soft)' : ACCENT_INK, border: `1px solid ${gap ? 'rgba(201,127,127,0.26)' : 'rgba(162,255,1,0.24)'}` }}>
              {gap ? '+ ' : '✓ '}{s}
            </span>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--gv-fainter)', lineHeight: 1.5, margin: '14px 0 0' }}>Consensus subtopics from live top-ranking pages. <span style={{ color: 'var(--gv-red)' }}>Amber</span> = a gap this draft doesn’t cover yet.</p>
    </div>
  );
}

function SourcesCard({ sources }: { sources: { name: string; host: string; icon: string }[] }) {
  return (
    <div className="gv-card" style={card()}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 14 }}>Sources cited</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sources.map((src, si) => (
          <div key={si} className="gv-qrow" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9 }}>
            <span style={{ color: 'var(--gv-faint)', display: 'flex', flexShrink: 0 }}><Icon name={src.icon} size={14} /></span>
            <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{src.name}</span>
            <span style={{ fontSize: 11, color: 'var(--gv-fainter)', flexShrink: 0 }}>{src.host}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
