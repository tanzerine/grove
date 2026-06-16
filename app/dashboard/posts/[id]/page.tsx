import { supabaseServer } from '@/lib/supabase/server';
import { mdToHtml } from '@/lib/markdown';
import { notFound } from 'next/navigation';
import PostActions from './PostActions';
import PipelineTimeline from './PipelineTimeline';
import RichEditor from './RichEditor';
import LocalTime from '../../LocalTime';
import Link from 'next/link';
import { ScoreRing, RubricBars, bandColor, type RubricScores } from '../../QualityCharts';
import { scoreAeo } from '@/lib/aeo-score';
import { coverageGap } from '@/lib/pipeline/serp';
import { summarizeReadiness, type Readiness } from '@/lib/readiness';

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: p } = await sb.from('posts').select('*, domains(blog_slug,hostname)').eq('id', id).single();
  if (!p) notFound();
  const domain = (p as any).domains;

  // Manager evaluations (attempt 1, and 2 when a rewrite happened)
  const { data: evals } = await sb
    .from('post_evaluations')
    .select('attempt, action, scores, issues, created_at')
    .eq('post_id', id)
    .order('attempt', { ascending: true });

  const social = (p.social ?? {}) as { x?: string; linkedin?: string; instagram?: string };
  const validation = p.validation as { passed?: boolean; issues?: string[]; stats?: Record<string, number>; error?: string } | null;
  const bodyHtml = p.body_md ? mdToHtml(p.body_md) : '';

  // Detect inline images: count ![...](...) that appear after an H2 line
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

  // Plain-language readiness — the calm face of the validator/manager/SERP data.
  const managerOverall =
    evals && evals.length ? ((evals[evals.length - 1] as any)?.scores?.overall ?? null) : null;
  const readiness: Readiness | null = validation?.stats && p.body_md
    ? summarizeReadiness({ stats: validation.stats, issues: validation.issues, managerOverall })
    : null;

  return (
    <>
      <Link href="/dashboard" className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← Pipeline</Link>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14, gap: 24 }}>
        <h1 style={{ fontFamily: 'Clash Display', fontSize: 32, margin: 0, lineHeight: 1.15 }}>
          {p.title ?? p.topic ?? '(no title)'}
        </h1>
        <StatusBadge status={p.status} />
      </div>
      <p className="mono" style={{ fontSize: 12, color: 'var(--clay)', marginTop: 4 }}>
        Topic: {p.topic} · {validation?.stats?.word_count ? `${validation.stats.word_count} words · ` : ''}{validation?.stats?.citation_count ?? 0} citations
      </p>

      {p.status === 'scheduled' && p.scheduled_at && (
        <ScheduleLine color="#7B9EF0">Publishes <strong><LocalTime iso={p.scheduled_at} /></strong> (your local time)</ScheduleLine>
      )}
      {p.status === 'review' && p.scheduled_at && (
        <ScheduleLine color="#E0A040">Planned for <strong><LocalTime iso={p.scheduled_at} /></strong> — approve to lock it in</ScheduleLine>
      )}
      {p.status === 'published' && p.published_at && (
        <ScheduleLine color="var(--moss)">Published <strong><LocalTime iso={p.published_at} /></strong></ScheduleLine>
      )}

      <PostActions
        id={p.id}
        status={p.status}
        published={p.status === 'published'}
        publicUrl={p.status === 'published' ? `/b/${domain?.blog_slug}/${p.slug}` : null}
        hasSocial={!!(social.x || social.linkedin || social.instagram)}
        hasCover={!!p.cover_image_url}
        hasInlineImages={hasInlineImages}
      />

      {p.status === 'failed' && (
        <div style={{ background: '#fdecec', border: '1px solid #f5b5b5', color: '#a33', padding: 18, borderRadius: 10, marginTop: 20 }}>
          <b>Generation failed.</b>
          <div className="mono" style={{ fontSize: 12, marginTop: 6 }}>{validation?.error ?? 'Unknown error'}</div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
      </div>

      {readiness && <ReadinessPanel r={readiness} />}

      {(() => {
        const serp = (p.research as any)?.serp;
        const hasSerp = !!serp?.subtopics?.length && !!p.body_md;
        const hasDepth = (evals && evals.length > 0) || (validation?.stats && p.body_md) || (validation?.issues?.length ?? 0) > 0;
        if (!hasDepth) return null;
        return (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--clay)', padding: '8px 2px' }}>
              SEO &amp; AI details
            </summary>
            <div style={{ marginTop: 4 }}>
              {evals && evals.length > 0 && <QualityScoreCard evals={evals as any} />}
              {validation?.stats && p.body_md && <AeoReadinessCard report={scoreAeo(validation.stats)} />}
              {hasSerp && <SerpIntelCard subtopics={serp.subtopics as string[]} body={p.body_md!} />}
              {validation?.issues && validation.issues.length > 0 && (
                <div style={{ background: '#fef9e8', border: '1px solid #f0d674', padding: 16, borderRadius: 10, marginTop: 20 }}>
                  <b style={{ fontSize: 13 }}>Quality flags from validator</b>
                  <ul style={{ margin: '8px 0 0 18px', fontSize: 13 }}>
                    {validation.issues.map((i, idx) => <li key={idx} className="mono">{i}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>
        );
      })()}

      {/* Single article block: rendered, and editable in place for finished
          posts. Manual drafts arrive with an empty body and open in edit mode. */}
      {['review', 'scheduled', 'published'].includes(p.status) ? (
        <RichEditor
          postId={p.id}
          initialBody={p.body_md ?? ''}
          initialTitle={p.title ?? ''}
          initialMetaTitle={p.meta_title ?? ''}
          initialMetaDesc={p.meta_description ?? ''}
          canEdit
          autoEdit={!p.body_md}
        />
      ) : p.body_md && bodyHtml ? (
        <article
          className="prose"
          style={{ marginTop: 16, padding: '36px 44px', background: 'white', border: '1px solid var(--line)', borderRadius: 14, maxWidth: 'none' }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : null}

      {(social.x || social.linkedin || social.instagram) && (
        <>
          <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 40 }}>Social variants</h3>
          {social.x && <SocialBlock label="X thread" body={social.x} />}
          {social.linkedin && <SocialBlock label="LinkedIn" body={social.linkedin} />}
          {social.instagram && <SocialBlock label="Instagram" body={social.instagram} />}
        </>
      )}

      {p.meta_title && !['review', 'scheduled', 'published'].includes(p.status) && (
        <div style={{ marginTop: 32, padding: 16, background: 'var(--paper)', borderRadius: 10, fontSize: 14 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--clay)' }}>SEO META</div>
          <div style={{ marginTop: 6 }}><b>Title:</b> {p.meta_title}</div>
          <div style={{ marginTop: 4, color: 'var(--clay)' }}>{p.meta_description}</div>
        </div>
      )}
    </>
  );
}

function ReadinessPanel({ r }: { r: Readiness }) {
  const tone = r.status === 'ready'
    ? { bg: 'rgba(89,148,94,0.12)', fg: 'var(--moss)', icon: '✓' }
    : r.status === 'almost'
      ? { bg: 'rgba(224,160,64,0.14)', fg: '#b07a16', icon: '!' }
      : { bg: 'rgba(120,120,120,0.10)', fg: 'var(--clay)', icon: '·' };
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 18, boxShadow: 'var(--sh-md)', padding: '22px 24px', marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: tone.bg, color: tone.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: 'none' }}>{tone.icon}</span>
        <div style={{ fontFamily: 'Clash Display', fontSize: 20 }}>{r.headline}</div>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--clay)', margin: '12px 0 16px', lineHeight: 1.55 }}>
        Built to rank on Google and get quoted by AI — written in your voice.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {r.checks.map((c) => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
            <span style={{ color: c.ok ? 'var(--moss)' : 'var(--clay)', width: 16, fontSize: 15 }}>{c.ok ? '✓' : '○'}</span>
            <span style={{ color: c.ok ? 'var(--ink)' : 'var(--clay)' }}>{c.label}</span>
          </div>
        ))}
      </div>
      {r.notes.length > 0 ? (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--clay)', marginBottom: 8 }}>WORTH A LOOK</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.7 }}>
            {r.notes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ) : r.status === 'ready' ? (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--clay)' }}>grove handled the SEO and AI optimization — nothing needed from you.</div>
      ) : null}
    </div>
  );
}

function SerpIntelCard({ subtopics, body }: { subtopics: string[]; body: string }) {
  const missing = new Set(coverageGap(subtopics, body, 99).map((s) => s.toLowerCase()));
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginTop: 20 }}>
      <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>WHAT&apos;S RANKING FOR THIS TOPIC</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {subtopics.map((s) => {
          const gap = missing.has(s.toLowerCase());
          return (
            <span
              key={s}
              style={{
                fontSize: 12.5, padding: '4px 10px', borderRadius: 999,
                background: gap ? 'rgba(193,80,60,0.08)' : 'rgba(89,148,94,0.10)',
                color: gap ? '#b1503c' : 'var(--moss)',
                border: `1px solid ${gap ? 'rgba(193,80,60,0.28)' : 'rgba(89,148,94,0.25)'}`,
              }}
            >
              {gap ? '+ ' : '✓ '}{s}
            </span>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--clay)', margin: '12px 0 0', lineHeight: 1.5 }}>
        Consensus subtopics from the live top-ranking pages. <b style={{ color: '#b1503c' }}>Red</b> = a gap this draft doesn&apos;t cover yet.
      </p>
    </div>
  );
}

function AeoReadinessCard({ report }: { report: ReturnType<typeof scoreAeo> }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>AI SEARCH READINESS</span>
        <span style={{ fontFamily: 'Clash Display', fontSize: 22, color: bandColor(report.score) }}>
          {report.score}<span style={{ fontSize: 13, color: 'var(--clay)' }}>/100</span>
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {report.checks.map((c) => (
          <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ color: c.ok ? 'var(--moss)' : 'var(--clay)', width: 14 }}>{c.ok ? '✓' : '○'}</span>
            <span style={{ fontWeight: 500 }}>{c.label}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--clay)', marginLeft: 'auto' }}>{c.detail}</span>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: 'var(--clay)', margin: '12px 0 0', lineHeight: 1.5 }}>
        How ready this article is to be quoted by AI answers (ChatGPT, Perplexity, Google AI Overviews) and to win featured snippets.
      </p>
    </div>
  );
}

type EvalRow = { attempt: number; action: string; scores: RubricScores | null; issues: Array<{ severity: string }> | null; created_at: string };

function QualityScoreCard({ evals }: { evals: EvalRow[] }) {
  const latest = evals[evals.length - 1];
  const first = evals[0];
  const overall = Number(latest.scores?.overall ?? 0);
  const delta = evals.length > 1
    ? Number(latest.scores?.overall ?? 0) - Number(first.scores?.overall ?? 0)
    : null;
  const flagged = (latest.issues ?? []).filter((i) => i.severity === 'block' || i.severity === 'rewrite').length;

  const actionLabel: Record<string, { text: string; color: string }> = {
    approve: { text: 'Approved by manager', color: 'var(--moss)' },
    rewrite: { text: 'Sent back for rewrite', color: '#E0A040' },
    reject: { text: 'Rejected — routed to your review', color: '#b04a3b' },
  };
  const act = actionLabel[latest.action] ?? { text: latest.action, color: 'var(--clay)' };

  return (
    <section style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px', marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>
          MANAGER SCORE · ATTEMPT {latest.attempt}/2
        </div>
        <Link href="/dashboard/reviews" className="mono" style={{ fontSize: 11, color: 'var(--moss)' }}>
          all evaluations →
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <ScoreRing value={overall} />
        <RubricBars scores={latest.scores} />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: act.color }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: act.color, display: 'inline-block' }} />
          {act.text}
        </span>
        {delta !== null && (
          <span style={{ color: delta >= 0 ? 'var(--moss)' : '#b04a3b' }}>
            rewrite {delta >= 0 ? 'raised' : 'lowered'} the score {first.scores?.overall} → {latest.scores?.overall}
            {' '}({delta >= 0 ? '+' : ''}{delta})
          </span>
        )}
        {flagged > 0 && (
          <span style={{ color: bandColor(overall) }}>{flagged} flagged issue{flagged === 1 ? '' : 's'}</span>
        )}
      </div>
    </section>
  );
}

function ScheduleLine({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14, color: 'var(--ink)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    queued: { cls: 'queue', label: 'QUEUED' },
    researching: { cls: 'queue', label: 'RESEARCHING' },
    writing: { cls: 'writing', label: 'WRITING' },
    review: { cls: 'writing', label: 'REVIEW' },
    scheduled: { cls: 'writing', label: 'SCHEDULED' },
    published: { cls: 'live', label: 'LIVE' },
    failed: { cls: 'queue', label: 'FAILED' },
  };
  const b = map[status] ?? map.queued;
  return <span className={`badge ${b.cls}`}><span className="d" />{b.label}</span>;
}

function SocialBlock({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 14, padding: 20, background: 'white', border: '1px solid var(--line)', borderRadius: 12 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', marginBottom: 8 }}>{label.toUpperCase()}</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, margin: 0, lineHeight: 1.55 }}>{body}</pre>
    </div>
  );
}
