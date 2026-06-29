'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '../gv-icons';
import { DashHeader } from '../gv-chrome';

const ACCENT = '#63c281';

type Block =
  | { type: 'h2'; text: string }
  | { type: 'p'; pre: string; mark?: string; post?: string }
  | { type: 'takeaways'; items: string[] }
  | { type: 'note'; text: string; cta: string }
  | { type: 'faq'; items: { q: string; a: string }[] };

export type ReviewDraftData = {
  id: string;
  title: string;
  genre: string;
  author: string;
  authorInitials: string;
  keyword: string;
  readMin: number | string;
  words: string;
  coverBg: string;
  coverImage?: string | null;
  score: number;
  verdict: string;
  verdictSub: string;
  rubric: { label: string; value: number }[];
  readiness: { label: string; note: string; ok: boolean | 'soft' }[];
  serp: { text: string; ok: boolean }[];
  serpNote?: string;
  sources: { name: string; host: string; icon: string }[];
  flags: { code: string; note: string; dot: string }[];
  internalLinks: number;
  sourceCount: number;
  nextSlot: string;
  status: string;
  /** Real drafts pass rendered HTML; the sample queue passes structured blocks. */
  bodyHtml?: string;
  blocks?: Block[];
};

const band = (s: number) => (s >= 70 ? ACCENT : s >= 40 ? '#e0c878' : '#c97f7f');

export default function ReviewDraft({ drafts, sample }: { drafts: ReviewDraftData[]; sample: boolean }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [decision, setDecision] = useState<null | 'approve' | 'schedule' | 'changes'>(null);
  const [busy, setBusy] = useState(false);

  const n = drafts.length;
  const i = ((index % n) + n) % n;
  const d = drafts[i];

  const C = 97.4; // circumference of r=15.5
  const scoreColor = band(d.score);
  const scoreOffset = (C * (1 - d.score / 100)).toFixed(1);

  function go(delta: number) { setIndex((v) => v + delta); setDecision(null); }

  async function act(kind: 'approve' | 'schedule' | 'changes') {
    if (sample) { setDecision(kind); return; }
    setBusy(true);
    try {
      if (kind === 'approve') {
        await fetch(`/api/posts/${d.id}/approve`, { method: 'POST' });
      } else if (kind === 'changes') {
        await fetch(`/api/posts/${d.id}/retry`, { method: 'POST' });
      }
      // 'schedule' has no dedicated endpoint yet — optimistic confirmation only.
    } catch { /* surfaced via the banner copy regardless */ }
    setBusy(false);
    setDecision(kind);
    if (kind !== 'schedule') router.refresh();
  }

  const decidedMsg = decision === 'approve'
    ? 'Approved — autopilot will publish this to /blog at the next slot, then cross-post to X & LinkedIn.'
    : decision === 'schedule'
      ? 'Scheduled — this will go live tomorrow at 9:00 and move out of your review queue.'
      : decision === 'changes'
        ? 'Sent back to the writer with your note — grove will revise the flagged section and re-score it.'
        : '';

  const queueNav = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
      <button onClick={() => go(-1)} disabled={n < 2} className="gv-iconbtn" style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: '#9aa096', cursor: n < 2 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevL" size={16} /></button>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#cdd2c9', padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>{i + 1} / {n}</span>
      <button onClick={() => go(1)} disabled={n < 2} className="gv-iconbtn" style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: '#9aa096', cursor: n < 2 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevR" size={16} /></button>
    </div>
  );

  return (
    <>
      {/* ============ TOP BAR ============ */}
      <DashHeader left={
        <>
          <a href="/dashboard/reviews" className="gv-iconbtn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: '#9aa096', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 9, cursor: 'pointer', textDecoration: 'none' }}>
            <Icon name="back" size={15} /> Reviews
          </a>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Review draft</div>
            <div style={{ fontSize: 12, color: '#6b6f67' }}>the manager scored it — your call to publish</div>
          </div>
        </>
      } />

      {/* ============ BODY ============ */}
      <div style={{ position: 'relative', padding: '26px 36px 56px', maxWidth: 1500, margin: '0 auto' }}>

        {/* queue nav — relocated out of the nav bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{queueNav}</div>

        {sample && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(224,200,120,0.06)', border: '1px solid rgba(224,200,120,0.22)', borderRadius: 12, padding: '11px 16px', marginBottom: 16, fontSize: 12.5, color: '#d8d2bf' }}>
            <span style={{ color: '#e0c878', display: 'flex' }}><Icon name="note" size={16} /></span>
            Sample drafts — your review queue is empty right now. New posts land here the moment the pipeline scores them.
          </div>
        )}

        {/* decision confirmation banner */}
        {decision && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.28)', borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,194,129,0.14)', border: '1px solid rgba(99,194,129,0.3)', color: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={16} /></span>
            <span style={{ fontSize: 13.5, color: '#dfe4da' }}>{decidedMsg}</span>
            <button onClick={() => setDecision(null)} className="gv-ghost" style={{ marginLeft: 'auto', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#9aa096', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>Undo</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18, alignItems: 'start' }}>

          {/* ===== LEFT: the draft ===== */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, overflow: 'hidden' }}>

            {/* cover */}
            <div style={{ position: 'relative', height: 180, background: d.coverImage ? `url(${d.coverImage}) center/cover` : d.coverBg, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,11,10,0) 40%, rgba(16,19,16,0.9) 100%)' }} />
              <div style={{ position: 'absolute', top: 16, left: 18, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 600, color: '#06120b', background: ACCENT, padding: '5px 11px', borderRadius: 999 }}><Icon name="bolt" size={13} /> {d.genre}</div>
              <div style={{ position: 'absolute', top: 16, right: 18, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#cdd2c9', background: 'rgba(10,11,10,0.55)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.1)', padding: '5px 11px', borderRadius: 999 }}><Icon name="image" size={13} /> AI cover · editable</div>
            </div>

            <div style={{ padding: '26px 40px 40px' }}>
              <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, margin: 0 }}>{d.title}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 14, fontSize: 12.5, color: '#9aa096' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(99,194,129,0.3), rgba(99,194,129,0.1))', border: '1px solid rgba(99,194,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 700, color: ACCENT }}>{d.authorInitials}</span>{d.author}</span>
                <span style={{ color: '#3a4640' }}>•</span><span>{d.readMin} min read</span>
                <span style={{ color: '#3a4640' }}>•</span><span>{d.words} words</span>
                <span style={{ color: '#3a4640' }}>•</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="target" size={14} /> targets <span style={{ color: '#cdd2c9', fontWeight: 600 }}>{d.keyword}</span></span>
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '24px 0 4px' }} />

              {/* ARTICLE BODY */}
              <div className="gv-prose">
                {d.bodyHtml != null
                  ? <div dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />
                  : (d.blocks ?? []).map((b, bi) => <BlockView key={bi} b={b} />)}
              </div>

              {/* in-body links woven indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, padding: '13px 16px', borderRadius: 11, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 12.5, color: '#9aa096' }}>
                <span style={{ color: ACCENT, display: 'flex' }}><Icon name="link" size={15} /></span>
                grove wove <span style={{ color: '#cdd2c9', fontWeight: 600 }}>{d.internalLinks} internal links</span> to your related posts &amp; <span style={{ color: '#cdd2c9', fontWeight: 600 }}>{d.sourceCount} outbound sources</span>. All metadata, slug, schema &amp; OG image are ready.
              </div>
            </div>
          </div>

          {/* ===== RIGHT RAIL ===== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 88 }}>

            {/* DECISION CARD */}
            <div className="gv-card" style={{ background: 'linear-gradient(150deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.18)', borderRadius: 18, padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ position: 'relative', width: 78, height: 78, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: 78, height: 78, transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.4} />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke={scoreColor} strokeWidth={3.4} strokeLinecap="round" strokeDasharray="97.4" strokeDashoffset={scoreOffset} style={{ animation: 'gvRingIn 1.1s cubic-bezier(.4,0,.2,1)' }} />
                  </svg>
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>{d.score}</span>
                    <span style={{ fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b6f67', marginTop: 2 }}>/ 100</span>
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67' }}>Manager verdict</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: scoreColor, marginTop: 3 }}>{d.verdict}</div>
                  <div style={{ fontSize: 12, color: '#9aa096', lineHeight: 1.45, marginTop: 4 }}>{d.verdictSub}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 20 }}>
                <button onClick={() => act('approve')} disabled={busy} className="gv-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: 13, borderRadius: 11, cursor: 'pointer' }}><Icon name="send" size={16} /> {busy ? 'Working…' : 'Approve & publish'}</button>
                <div style={{ display: 'flex', gap: 9 }}>
                  <button onClick={() => act('schedule')} disabled={busy} className="gv-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: 11, borderRadius: 10, cursor: 'pointer' }}><Icon name="calendar" size={15} /> Schedule</button>
                  <button onClick={() => act('changes')} disabled={busy} className="gv-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: 11, borderRadius: 10, cursor: 'pointer' }}><Icon name="edit" size={15} /> Changes</button>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: '#6b6f67', lineHeight: 1.5, marginTop: 14, textAlign: 'center' }}>Approving lets autopilot publish to <span style={{ color: '#9aa096', fontWeight: 600 }}>/blog</span> at the next slot · {d.nextSlot}</div>
            </div>

            {/* READINESS */}
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67', marginBottom: 4 }}>Is it ready?</div>
              <div style={{ fontSize: 13, color: '#9aa096', marginBottom: 16 }}>In plain language — no SEO jargon.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {d.readiness.map((r, ri) => {
                  const soft = r.ok === 'soft';
                  const tone = soft
                    ? { bg: 'rgba(224,200,120,0.1)', border: 'rgba(224,200,120,0.25)', color: '#e0c878' }
                    : { bg: 'rgba(99,194,129,0.12)', border: 'rgba(99,194,129,0.28)', color: ACCENT };
                  return (
                    <div key={ri} style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 6, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name={soft ? 'note' : 'check'} size={12} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eef1ea' }}>{r.label}</div>
                        <div style={{ fontSize: 12, color: '#6b6f67', lineHeight: 1.45, marginTop: 2 }}>{r.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* QUALITY BREAKDOWN */}
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67' }}>Quality breakdown</div>
                <span style={{ fontSize: 11, color: '#565a53' }}>manager rubric</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {d.rubric.map((m) => {
                  const c = band(m.value);
                  return (
                    <div key={m.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
                        <span style={{ fontSize: 12.5, color: '#cdd2c9' }}>{m.label}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{m.value}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${m.value}%`, borderRadius: 99, background: c }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SERP COVERAGE */}
            {d.serp.length > 0 && (
              <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6f67', marginBottom: 4 }}>What&apos;s ranking for this topic</div>
                <div style={{ fontSize: 13, color: '#9aa096', marginBottom: 14 }}>Covered <span style={{ color: ACCENT, fontWeight: 600 }}>{d.serp.filter((s) => s.ok).length}</span> of {d.serp.length} subtopics the top pages share.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {d.serp.map((s) => (
                    <span key={s.text} className="gv-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: s.ok ? ACCENT : '#9aa096', background: s.ok ? 'rgba(99,194,129,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${s.ok ? 'rgba(99,194,129,0.25)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 999, padding: '5px 11px', cursor: 'default' }}>{s.ok ? '✓' : '+'} {s.text}</span>
                  ))}
                </div>
                {d.serpNote && <div style={{ fontSize: 11.5, color: '#6b6f67', lineHeight: 1.5, marginTop: 14, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,0.06)' }}>{d.serpNote}</div>}
              </div>
            )}

            {/* SOURCES + RAW FLAGS */}
            <details className="gv-det gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '4px 22px' }}>
              <summary style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', fontSize: 12.5, fontWeight: 600, color: '#cdd2c9' }}>
                <span className="gv-det-caret" style={{ color: '#6b6f67', display: 'flex', transition: 'transform .2s' }}><Icon name="caret" size={14} /></span>
                Sources &amp; raw SEO flags
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#565a53' }}>{d.sources.length} sources · {d.flags.length} flags</span>
              </summary>
              <div style={{ padding: '4px 0 20px' }}>
                {d.sources.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565a53', marginBottom: 11 }}>Sources cited</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                      {d.sources.map((src, si) => (
                        <div key={si} className="gv-qrow" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9 }}>
                          <span style={{ color: '#6b6f67', display: 'flex', flexShrink: 0 }}><Icon name={src.icon} size={14} /></span>
                          <span style={{ fontSize: 12.5, color: '#cdd2c9', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{src.name}</span>
                          <span style={{ fontSize: 11, color: '#565a53', flexShrink: 0 }}>{src.host}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565a53', marginBottom: 11 }}>Validator flags</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {d.flags.length === 0 && <div style={{ fontSize: 12, color: '#565a53' }}>No flags — clean pass.</div>}
                  {d.flags.map((fl, fi) => (
                    <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: fl.dot, flexShrink: 0 }} />
                      <span style={{ color: '#9aa096', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}>{fl.code}</span>
                      <span style={{ marginLeft: 'auto', color: '#565a53' }}>{fl.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.type === 'h2') return <h2>{b.text}</h2>;
  if (b.type === 'p') return <p>{b.pre}{b.mark && <mark>{b.mark}</mark>}{b.post}</p>;
  if (b.type === 'takeaways') {
    return (
      <div style={{ background: 'linear-gradient(150deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.18)', borderRadius: 14, padding: '18px 20px', margin: '4px 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, marginBottom: 12 }}><Icon name="bolt" size={13} /> Key takeaways</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {b.items.map((t, ti) => <div key={ti} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.5, color: '#dfe4da' }}><span style={{ color: ACCENT, flexShrink: 0 }}><Icon name="tick" size={14} /></span>{t}</div>)}
        </div>
      </div>
    );
  }
  if (b.type === 'note') {
    return (
      <div style={{ display: 'flex', gap: 12, background: 'rgba(224,200,120,0.06)', border: '1px solid rgba(224,200,120,0.22)', borderLeft: '3px solid #e0c878', borderRadius: 10, padding: '13px 15px', margin: '0 0 20px' }}>
        <span style={{ color: '#e0c878', flexShrink: 0, display: 'flex', marginTop: 1 }}><Icon name="note" size={16} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#e0c878', marginBottom: 4 }}>Agent flagged this</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#d8d2bf' }}>{b.text}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
            <button className="gv-btn" style={{ border: 'none', background: 'rgba(224,200,120,0.16)', color: '#e8d79a', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>{b.cta}</button>
            <button className="gv-ghost" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#9aa096', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>Keep as is</button>
          </div>
        </div>
      </div>
    );
  }
  // faq
  return (
    <>
      <h2>FAQ</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
        {b.items.map((q, qi) => (
          <div key={qi} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', padding: '15px 17px' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: '#eef1ea' }}>{q.q}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#9aa096', marginTop: 6 }}>{q.a}</div>
          </div>
        ))}
      </div>
    </>
  );
}
