'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchIntent } from '@/lib/strategy/keywords';
import Icon from '../gv-icons';
import { useUpsell } from '../Upsell';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

const PROMPTS = [
  'A problem customers keep hitting',
  'A question I get asked a lot',
  'Us vs. the alternative',
  'A mistake beginners make',
  'Behind the scenes',
  'A strong opinion I hold',
];

type Tab = 'idea' | 'seo';

/**
 * The "Start a draft" card that lives in the Write editor's right rail:
 * Idea studio (grove suggests angles) and SEO set (one page per real search).
 * A blank page is the editor to the left — these are the two assisted ways in.
 */
export default function StartDraft({ domainId, hostname }: { domainId: string; hostname: string }) {
  const r = useRouter();
  const { gate } = useUpsell();
  const [tab, setTab] = useState<Tab>('idea');

  // idea studio
  const [focus, setFocus] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyIdea, setBusyIdea] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'mine' | 'grove' | null>(null);

  // programmatic SEO
  type PseoPage = { keyword: string; title: string; intent: SearchIntent };
  const [seed, setSeed] = useState('');
  const [count, setCount] = useState(6);
  const [pages, setPages] = useState<PseoPage[]>([]);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pseoErr, setPseoErr] = useState<string | null>(null);

  async function generate() {
    setThinking(true); setErr(null);
    try {
      const qs = new URLSearchParams({ domain_id: domainId });
      if (focus.trim()) qs.set('focus', focus.trim());
      const res = await fetch(`/api/topics/suggest?${qs}`);
      const j = await res.json().catch(() => ({}));
      const s: string[] = j.suggestions ?? [];
      if (s.length) setIdeas(s);
      else setErr('Could not come up with ideas — build your site profile first.');
    } catch { setErr('Something went wrong. Try again.'); }
    setThinking(false);
  }

  async function writeMine(topic: string) {
    setBusyIdea(topic); setBusyKind('mine');
    const res = await fetch('/api/posts/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, title: topic }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) { r.push(`/dashboard/posts/${j.id}`); return; }
    setBusyIdea(null); setBusyKind(null);
  }

  async function groveWrites(topic: string) {
    if (!gate('write')) return;
    setBusyIdea(topic); setBusyKind('grove');
    await fetch('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, topic }),
    });
    r.push('/dashboard');
  }

  async function previewSet() {
    if (!gate('pseo')) return;
    setPlanning(true); setPseoErr(null); setPages([]);
    try {
      const res = await fetch('/api/pseo/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, seed: seed.trim(), count }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) setPseoErr('Build your site profile first.');
      else if (!res.ok || !j.pages?.length) setPseoErr('Could not plan a set — try a broader term.');
      else setPages(j.pages);
    } catch { setPseoErr('Something went wrong. Try again.'); }
    setPlanning(false);
  }

  async function generateSet() {
    if (!pages.length) return;
    if (!gate('pseo')) return;
    setGenerating(true); setPseoErr(null);
    try {
      const res = await fetch('/api/pseo/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, pages }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.created > 0) { r.push('/dashboard'); return; }
      setPseoErr('Generation failed — no pages were created.');
    } catch { setPseoErr('Something went wrong. Try again.'); }
    setGenerating(false);
  }

  return (
    <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '16px 16px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
        <span style={iconBadge}><Icon name="write" size={15} /></span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)' }}>Start a draft</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gv-faint)' }}>assisted</span>
      </div>

      <div style={tabRow}>
        {([['idea', 'Idea studio'], ['seo', 'SEO set']] as const).map(([k, label]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} className="gv-tool"
              style={{ flex: 1, border: `1px solid ${on ? 'rgba(162,255,1,0.3)' : 'transparent'}`, background: on ? 'rgba(162,255,1,0.14)' : 'transparent', color: on ? ACCENT_INK : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '6px 4px', borderRadius: 8, cursor: 'pointer' }}>
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'idea' && (
        <div>
          <div style={desc}>Give grove a nudge and it&apos;ll suggest angles for <b style={{ color: 'var(--gv-soft)' }}>{hostname}</b>.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 11 }}>
            {PROMPTS.map((p) => (
              <button key={p} onClick={() => setFocus(p)} className="gv-chip" style={chip}>{p}</button>
            ))}
          </div>
          <input value={focus} onChange={(e) => setFocus(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generate()}
            placeholder="What's on your mind? (optional)" className="gv-prompt" style={field} />
          <button onClick={generate} disabled={thinking} className="gv-btn" style={primaryBtn}>
            <span style={{ display: 'flex' }}><Icon name="sparkle" size={13} /></span>{thinking ? 'Thinking…' : ideas.length ? 'More ideas' : 'Generate ideas'}
          </button>
          {err && <p style={errText}>{err}</p>}
          {ideas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
              {ideas.map((idea, i) => {
                const busy = busyIdea === idea;
                return (
                  <div key={i} style={row}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--gv-ink)' }}>{idea}</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => writeMine(idea)} disabled={!!busyIdea} className="gv-ghost"
                        style={{ border: '1px solid rgba(15,23,18,0.12)', background: 'transparent', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}>
                        {busy && busyKind === 'mine' ? 'Opening…' : 'Write myself'}
                      </button>
                      <button onClick={() => groveWrites(idea)} disabled={!!busyIdea} className="gv-btn"
                        style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}>
                        <Icon name="sparkle" size={11} />{busy && busyKind === 'grove' ? 'Queuing…' : 'grove writes it'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'seo' && (
        <div>
          <div style={desc}>Give a seed term — grove drafts one focused page per real search, into your pipeline.</div>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && seed.trim().length >= 2 && previewSet()}
            placeholder="Seed term — e.g. 'cold brew'" className="gv-prompt" style={field} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of pages"
              style={{ background: 'rgba(15,23,18,0.03)', border: '1px solid rgba(15,23,18,0.1)', borderRadius: 10, padding: '9px 10px', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>
              {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n} style={{ background: 'var(--gv-card)' }}>{n} pages</option>)}
            </select>
            <button onClick={previewSet} disabled={planning || seed.trim().length < 2} className="gv-ghost"
              style={{ flex: 1, border: '1px solid rgba(15,23,18,0.12)', background: 'rgba(15,23,18,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '9px', borderRadius: 10, cursor: 'pointer' }}>
              {planning ? 'Planning…' : 'Preview set'}
            </button>
          </div>
          {pseoErr && <p style={errText}>{pseoErr}</p>}
          {pages.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pages.map((p, i) => (
                  <div key={i} style={row}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--gv-ink)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', marginRight: 7, background: intentColor(p.intent), verticalAlign: 'middle' }} />
                      {p.title}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--gv-dim)', marginTop: 2 }}>targets “{p.keyword}”</span>
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={generateSet} disabled={generating} className="gv-btn" style={{ ...primaryBtn, marginTop: 12 }}>
                <span style={{ display: 'flex' }}><Icon name="sparkle" size={13} /></span>
                {generating ? `Drafting ${pages.length}…` : `Generate ${pages.length} pages`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function intentColor(intent: SearchIntent): string {
  return intent === 'transactional' ? ACCENT
    : intent === 'commercial' ? 'var(--gv-blue)'
    : intent === 'navigational' ? 'var(--gv-dim)'
    : 'var(--gv-amber)';
}

const iconBadge: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, background: 'rgba(162,255,1,0.14)', border: '1px solid rgba(162,255,1,0.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT_INK,
};
const tabRow: React.CSSProperties = {
  display: 'flex', gap: 4, padding: 3, background: 'rgba(15,23,18,0.03)', border: '1px solid var(--gv-line)',
  borderRadius: 10, marginBottom: 14,
};
const desc: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--gv-dim)', margin: '0 0 11px' };
const field: React.CSSProperties = {
  width: '100%', background: 'rgba(15,23,18,0.03)', border: '1px solid rgba(15,23,18,0.1)', borderRadius: 10,
  padding: '9px 12px', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', marginBottom: 10,
};
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', border: 'none',
  background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: 10, borderRadius: 10, cursor: 'pointer',
};
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--gv-dim)', background: 'rgba(15,23,18,0.03)', border: '1px solid rgba(15,23,18,0.09)',
  borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
};
const row: React.CSSProperties = {
  padding: '10px 12px', background: 'rgba(15,23,18,0.02)', border: '1px solid var(--gv-line)', borderRadius: 10,
};
const errText: React.CSSProperties = { fontSize: 12, color: 'var(--gv-red)', margin: '10px 0 0' };
