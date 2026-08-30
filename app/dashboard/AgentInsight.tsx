'use client';
/**
 * The "Agent insight" panel on the overview — and, crucially, the action the
 * insight promises. When the agent says it *can build a content cluster* around
 * your top performer, this component is what actually builds it: it plans a
 * spoke set off the winner's seed phrase (`/api/pseo/plan`), shows exactly what
 * grove is about to write, and generates the pages into review
 * (`/api/pseo/generate`). Previously the only button here was a link to the
 * strategy page, which read as a dead end — the agent claimed work it never did.
 *
 * "Review plan" survives as the secondary route, because the cluster is a
 * deviation from the monthly plan and some owners will want to look there first.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from './gv-icons';
import { useUpsell } from './Upsell';
import { useT } from './i18n';

const ACCENT = 'var(--gv-accent)';
const SAGE = '#9aa094';

/** Number of spokes we plan around the hub — enough to read as a cluster,
 *  small enough to stay inside one generation batch and one month's quota. */
const SPOKES = 5;

type Page = { keyword: string; title: string; intent: string };
type Cluster = { domainId: string; seed: string; hubTitle: string };

export default function AgentInsight({
  text,
  cluster,
  action,
}: {
  text: string;
  /** Present when the insight is about a top performer we can cluster around. */
  cluster?: Cluster | null;
  /** Primary CTA when there's no cluster to build (e.g. drafts are waiting). */
  action?: { label: string; href: string };
}) {
  const t = useT();
  const r = useRouter();
  const { gate } = useUpsell();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function plan() {
    if (!cluster) return;
    if (!gate('pseo')) return;
    setPlanning(true); setErr(null);
    try {
      const res = await fetch('/api/pseo/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: cluster.domainId, seed: cluster.seed, count: SPOKES }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) setErr(t('I need your site profile before I can plan a cluster.'));
      else if (res.status === 402) setErr(j.message ?? t('An active plan is required to generate content.'));
      else if (!res.ok || !j.pages?.length) setErr(t('Couldn’t find enough related searches to cluster around this one.'));
      else setPages(j.pages);
    } catch { setErr(t('Something went wrong. Try again.')); }
    setPlanning(false);
  }

  async function build() {
    if (!cluster || !pages?.length) return;
    if (!gate('pseo')) return;
    setGenerating(true); setErr(null);
    try {
      const res = await fetch('/api/pseo/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: cluster.domainId, pages }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.created > 0) { r.push('/dashboard/pipeline'); r.refresh(); return; }
      setErr(j.message ?? t('Generation failed — nothing was written.'));
    } catch { setErr(t('Something went wrong. Try again.')); }
    setGenerating(false);
  }

  const primary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: ACCENT,
    color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700,
    padding: '7px 13px', borderRadius: 8, cursor: 'pointer', textDecoration: 'none',
  };
  const ghost: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.06)', color: 'var(--gv-ink)', fontFamily: 'inherit',
    fontSize: 11.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer',
    textDecoration: 'none',
  };

  return (
    <div style={{ marginTop: 18, padding: '14px 15px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: SAGE, marginBottom: 8 }}>
        <span style={{ display: 'flex' }}><Icon name="answers" /></span> {t('Agent insight')}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--gv-soft)', lineHeight: 1.55 }}>{text}</div>

      {/* The planned cluster: the hub is the post that already wins, the spokes
          are the sibling searches grove is about to cover and cross-link. */}
      {pages && pages.length > 0 && (
        <div style={{ marginTop: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '11px 12px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 8 }}>
            Cluster around “{cluster?.seed}”
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', marginBottom: 9, lineHeight: 1.45 }}>
            Hub: “{cluster?.hubTitle}” · {pages.length} new page{pages.length === 1 ? '' : 's'}, each targeting a real related search. They land in review, cross-linked to the hub.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pages.map((p, i) => (
              <div key={i} style={{ padding: '7px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.35 }}>{p.title}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--gv-dim)', marginTop: 2 }}>targets “{p.keyword}”</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p style={{ fontSize: 11.5, color: 'var(--gv-red-text)', margin: '10px 0 0', lineHeight: 1.45 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {cluster ? (
          pages ? (
            <>
              <button onClick={build} disabled={generating} className="gv-btn" style={{ ...primary, opacity: generating ? 0.7 : 1 }}>
                <Icon name="sparkle" size={11} />
                {generating ? `Writing ${pages.length}…` : `Write ${pages.length} page${pages.length === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => { setPages(null); setErr(null); }} disabled={generating} className="gv-ghost" style={ghost}>
                {t('Not now')}
              </button>
            </>
          ) : (
            <button onClick={plan} disabled={planning} className="gv-btn" style={{ ...primary, opacity: planning ? 0.7 : 1 }}>
              <Icon name="sparkle" size={11} />
              {planning ? t('Finding related searches…') : t('Build the cluster')}
            </button>
          )
        ) : action ? (
          <Link href={action.href} className="gv-btn" style={primary}>{action.label}</Link>
        ) : null}

        {!generating && (
          <Link href="/dashboard/strategy" className="gv-ghost" style={cluster || action ? ghost : primary}>{t('Review plan')}</Link>
        )}
      </div>
    </div>
  );
}
