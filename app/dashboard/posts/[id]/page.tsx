import { supabaseServer } from '@/lib/supabase/server';
import { mdToHtml } from '@/lib/markdown';
import { notFound } from 'next/navigation';
import PostActions from './PostActions';
import PipelineTimeline from './PipelineTimeline';
import RichEditor from './RichEditor';
import ProcessDrawer from './ProcessDrawer';
import LocalTime from '../../LocalTime';
import Link from 'next/link';
import { ScoreRing, RubricBars, bandColor, type RubricScores } from '../../QualityCharts';
import { scoreAeo } from '@/lib/aeo-score';
import { coverageGap } from '@/lib/pipeline/serp';
import { summarizeReadiness, type Readiness } from '@/lib/readiness';
import Icon from '../../gv-icons';
import { DashHeader } from '../../gv-chrome';

const ACCENT = 'var(--gv-accent)';

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: p } = await sb.from('posts').select('*, domains(blog_slug,hostname)').eq('id', id).single();
  if (!p) notFound();
  const domain = (p as any).domains;

  const { data: evals } = await sb
    .from('post_evaluations')
    .select('attempt, action, scores, issues, created_at')
    .eq('post_id', id)
    .order('attempt', { ascending: true });

  const social = (p.social ?? {}) as { x?: string; linkedin?: string; instagram?: string };
  const validation = p.validation as { passed?: boolean; issues?: string[]; stats?: Record<string, number>; error?: string } | null;
  const bodyHtml = p.body_md ? mdToHtml(p.body_md) : '';

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
  const readiness: Readiness | null = validation?.stats && p.body_md
    ? summarizeReadiness({ stats: validation.stats, issues: validation.issues, managerOverall }) : null;

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
    review: { label: 'In review', color: 'var(--gv-amber)', bg: 'rgba(224,200,120,0.08)', border: 'rgba(224,200,120,0.24)' },
    scheduled: { label: 'Scheduled', color: 'var(--gv-sky)', bg: 'rgba(127,182,230,0.08)', border: 'rgba(127,182,230,0.24)' },
    published: { label: 'Live', color: ACCENT, bg: 'rgba(99,194,129,0.08)', border: 'rgba(99,194,129,0.24)' },
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
          {p.topic && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--gv-dim)' }}>
              <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="target" size={13} /></span> Target · <span style={{ color: 'var(--gv-soft)', fontWeight: 600 }}>{p.topic}</span>
            </span>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--gv-fainter)' }}>
            {words ? `·  ${words.toLocaleString()} words  ` : ''}{cites ? `·  ${cites} citations  ` : ''}{readMin ? `·  ${readMin} min read` : ''}
          </span>
          {p.scheduled_at && (
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Planned for</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}><LocalTime iso={p.scheduled_at} /></span>
            </div>
          )}
        </div>
        {!editable && (
          <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 38, lineHeight: 1.12, letterSpacing: '-0.01em', margin: '8px 0 0', maxWidth: 880 }}>
            {p.title ?? p.topic ?? '(no title)'}
          </h1>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <PostActions
            id={p.id}
            status={p.status}
            published={p.status === 'published'}
            publicUrl={p.status === 'published' ? `/b/${domain?.blog_slug}/${p.slug}` : null}
            hasSocial={!!(social.x || social.linkedin || social.instagram)}
            hasCover={!!p.cover_image_url}
            hasInlineImages={hasInlineImages}
          />
          {editable && (
            <ProcessDrawer unusual={unusual}>
              {readiness && <ReadinessCard r={readiness} />}
              {evals && evals.length > 0 && <ManagerCard evals={evals as any} />}
              {validation?.stats && p.body_md && <AeoCard report={scoreAeo(validation.stats)} />}
              {hasSerp && <SerpCard subtopics={serp.subtopics as string[]} body={p.body_md!} />}
              {sources.length > 0 && <SourcesCard sources={sources} />}
              <div style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-faint)', marginBottom: 14 }}>Pipeline timeline</div>
                <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
              </div>
            </ProcessDrawer>
          )}
        </div>

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
                initialBody={p.body_md ?? ''}
                initialTitle={p.title ?? ''}
                initialMetaTitle={p.meta_title ?? ''}
                initialMetaDesc={p.meta_description ?? ''}
                canEdit
                autoEdit={!p.body_md}
              />
            </div>

            {(social.x || social.linkedin || social.instagram) && (
              <div style={{ marginTop: 18, background: '#0e110d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 28px 28px' }}>
                <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 22, margin: '4px 0 4px' }}>Social variants</h3>
                {social.x && <SocialBlock label="X thread" body={social.x} />}
                {social.linkedin && <SocialBlock label="LinkedIn" body={social.linkedin} />}
                {social.instagram && <SocialBlock label="Instagram" body={social.instagram} />}
              </div>
            )}
          </>
        ) : (
          /* ===== not yet editable: reading surface + review rail ===== */
          <div className="gv-2col-rail" style={{ display: 'grid', gridTemplateColumns: '1fr 372px', gap: 22, alignItems: 'start', marginTop: 22 }}>
            <div style={{ background: '#0e110d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, overflow: 'hidden' }}>
              {p.body_md && bodyHtml ? (
                <article className="prose article-surface" style={{ maxWidth: 'none', color: 'var(--gv-soft)', padding: '40px 44px' }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              ) : (
                <div style={{ padding: '40px 44px', color: 'var(--gv-faint)' }}>
                  <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
                </div>
              )}
            </div>
            <div className="gv-rail" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 78 }}>
              {readiness && <ReadinessCard r={readiness} />}
              {evals && evals.length > 0 && <ManagerCard evals={evals as any} />}
              {validation?.stats && p.body_md && <AeoCard report={scoreAeo(validation.stats)} />}
              {hasSerp && <SerpCard subtopics={serp.subtopics as string[]} body={p.body_md!} />}
              <div style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
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
  return { background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px', ...extra };
}

function ReadinessCard({ r }: { r: Readiness }) {
  return (
    <div className="gv-card" style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(99,194,129,0.2)', borderRadius: 18, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(99,194,129,0.14)', border: '1px solid rgba(99,194,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, flexShrink: 0 }}><Icon name="check" size={16} /></span>
        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 500, color: 'var(--gv-ink)', lineHeight: 1.2 }}>{r.headline}</div>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '13px 0 15px' }}>Built to rank on Google and get quoted by AI — written in your voice.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {r.checks.map((c) => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ color: c.ok ? ACCENT : 'var(--gv-faint)', display: 'flex' }}>{c.ok ? <Icon name="check" size={15} /> : <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--gv-fainter)', display: 'inline-block' }} />}</span>
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
    approve: { text: 'Approved by the manager agent', color: ACCENT },
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
            <span style={{ color: c.ok ? ACCENT : 'var(--gv-fainter)', display: 'flex', flexShrink: 0 }}>{c.ok ? <Icon name="check" size={14} /> : <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--gv-fainter)', display: 'inline-block' }} />}</span>
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
            <span key={s} className="gv-chip" style={{ fontSize: 12, padding: '5px 11px', borderRadius: 999, background: gap ? 'rgba(201,127,127,0.08)' : 'rgba(99,194,129,0.08)', color: gap ? 'var(--gv-red-soft)' : ACCENT, border: `1px solid ${gap ? 'rgba(201,127,127,0.26)' : 'rgba(99,194,129,0.24)'}` }}>
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

function SocialBlock({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 14, padding: '18px 20px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14 }}>
      <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8, fontWeight: 700, letterSpacing: '0.06em' }}>{label.toUpperCase()}</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, margin: 0, lineHeight: 1.55, color: '#c4cabb' }}>{body}</pre>
    </div>
  );
}
