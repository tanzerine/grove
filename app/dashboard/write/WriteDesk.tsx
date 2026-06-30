'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchIntent } from '@/lib/strategy/keywords';
import Icon from '../gv-icons';

const ACCENT = '#63c281';

// Thinking prompts — clicking one drops a starter angle into the focus box so
// a blank page never stays blank. They nudge the author toward what they
// actually know, instead of asking them to invent a "topic" cold.
const PROMPTS: { label: string; seed: string }[] = [
  { label: 'A problem customers keep hitting', seed: 'the problem my customers run into most often' },
  { label: 'A question I get asked a lot',      seed: 'the question prospects ask me again and again' },
  { label: 'Us vs. the alternative',            seed: 'how we compare to the usual alternative people consider' },
  { label: 'A mistake beginners make',          seed: 'a common mistake beginners make in my field' },
  { label: 'Behind the scenes',                 seed: 'how we actually do the work behind the scenes' },
  { label: 'A strong opinion I hold',           seed: 'an opinion I hold that not everyone agrees with' },
];

type Mode = 'blank' | 'idea' | 'seo';
const TABS: { key: Mode; label: string }[] = [
  { key: 'blank', label: 'Blank' },
  { key: 'idea', label: 'Idea studio' },
  { key: 'seo', label: 'SEO set' },
];

export default function WriteDesk({ domainId, hostname }: { domainId: string; hostname: string }) {
  const r = useRouter();
  const [mode, setMode] = useState<Mode>('blank');

  // ── blank draft ─────────────────────────────────────────────
  const [blankTitle, setBlankTitle] = useState('');
  const [opening, setOpening] = useState(false);

  // ── idea studio ─────────────────────────────────────────────
  const [focus, setFocus] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyIdea, setBusyIdea] = useState<string | null>(null);   // topic being acted on
  const [busyKind, setBusyKind] = useState<'mine' | 'grove' | null>(null);

  // ── programmatic SEO ────────────────────────────────────────
  type PseoPage = { keyword: string; title: string; intent: SearchIntent };
  const [seed, setSeed] = useState('');
  const [count, setCount] = useState(6);
  const [pages, setPages] = useState<PseoPage[]>([]);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pseoErr, setPseoErr] = useState<string | null>(null);

  async function previewSet() {
    setPlanning(true); setPseoErr(null); setPages([]);
    try {
      const res = await fetch('/api/pseo/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, seed: seed.trim(), count }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) setPseoErr('Build your site profile first — grove needs to know the business before it can plan pages.');
      else if (!res.ok || !j.pages?.length) setPseoErr('Could not plan a set for that seed. Try a broader term.');
      else setPages(j.pages);
    } catch { setPseoErr('Something went wrong. Try again.'); }
    setPlanning(false);
  }

  async function generateSet() {
    if (!pages.length) return;
    setGenerating(true); setPseoErr(null);
    try {
      const res = await fetch('/api/pseo/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, pages }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.created > 0) { r.push('/dashboard'); return; }
      setPseoErr('Generation failed — no pages were created.');
    } catch { setPseoErr('Something went wrong generating the set.'); }
    setGenerating(false);
  }

  async function openBlank() {
    setOpening(true);
    const res = await fetch('/api/posts/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, title: blankTitle.trim() || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) { r.push(`/dashboard/posts/${j.id}`); return; }
    setOpening(false);
  }

  async function generate() {
    setThinking(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ domain_id: domainId });
      if (focus.trim()) qs.set('focus', focus.trim());
      const res = await fetch(`/api/topics/suggest?${qs}`);
      const j = await res.json().catch(() => ({}));
      const s: string[] = j.suggestions ?? [];
      if (s.length) setIdeas(s);
      else setErr('Could not come up with ideas — make sure your site profile is built first.');
    } catch {
      setErr('Something went wrong generating ideas. Try again.');
    }
    setThinking(false);
  }

  // Write it yourself: blank-but-titled draft, straight into the editor.
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

  // Hand it to grove: kicks off the full pipeline, lands back on the pipeline.
  async function groveWrites(topic: string) {
    setBusyIdea(topic); setBusyKind('grove');
    await fetch('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, topic }),
    });
    r.push('/dashboard');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 26, maxWidth: 680 }}>

      {/* ── Start a draft ─────────────────────────────────────── */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <span style={iconBadge}><Icon name="write" size={15} /></span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#eef1ea' }}>Start a draft</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b6f67' }}>3 ways in</span>
        </div>

        {/* segmented tabs */}
        <div style={tabRow}>
          {TABS.map((t) => {
            const on = mode === t.key;
            return (
              <button key={t.key} onClick={() => setMode(t.key)} className="gv-tool"
                style={{ flex: 1, border: `1px solid ${on ? 'rgba(99,194,129,0.3)' : 'transparent'}`, background: on ? 'rgba(99,194,129,0.14)' : 'transparent', color: on ? ACCENT : '#9aa096', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 4px', borderRadius: 8, cursor: 'pointer' }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Blank */}
        {mode === 'blank' && (
          <div>
            <div style={kicker}>Start from a blank page</div>
            <div style={desc}>Open the editor and write it yourself. You can name it now or later.</div>
            <input
              value={blankTitle}
              onChange={(e) => setBlankTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && openBlank()}
              placeholder="Working title (optional)"
              className="gv-prompt"
              style={{ ...field, marginBottom: 10 }}
            />
            <button onClick={openBlank} disabled={opening} className="gv-btn" style={primaryBtn}>
              {opening ? 'Opening…' : <>Open blank editor <span style={{ display: 'flex' }}><Icon name="send" size={13} /></span></>}
            </button>
          </div>
        )}

        {/* Idea studio */}
        {mode === 'idea' && (
          <div>
            <div style={kicker}>Idea studio</div>
            <div style={desc}>
              Give grove a nudge — a theme, a product, a question on your mind — and it&apos;ll suggest angles for <b style={{ color: '#cdd2c9' }}>{hostname}</b>.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {PROMPTS.map((p) => (
                <button key={p.label} onClick={() => setFocus(p.seed)} className="gv-chip" style={chip}>{p.label}</button>
              ))}
            </div>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && generate()}
              placeholder="What's on your mind? (optional)"
              className="gv-prompt"
              style={{ ...field, marginBottom: 10 }}
            />
            <button onClick={generate} disabled={thinking} className="gv-btn" style={primaryBtn}>
              <span style={{ display: 'flex' }}><Icon name="sparkle" size={13} /></span>
              {thinking ? 'Thinking…' : ideas.length ? 'More ideas' : 'Generate ideas'}
            </button>
            {err && <p style={errText}>{err}</p>}
          </div>
        )}

        {/* SEO set */}
        {mode === 'seo' && (
          <div>
            <div style={kicker}>Programmatic SEO · generate a set</div>
            <div style={desc}>
              Give a seed term — grove finds the real searches around it and drafts one focused page per query. Each lands in your pipeline for review, cross-linked automatically once published.
            </div>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && seed.trim().length >= 2 && previewSet()}
              placeholder="Seed term — e.g. 'cold brew'"
              className="gv-prompt"
              style={{ ...field, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of pages"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 10px', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
                {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n} style={{ background: '#101310' }}>{n} pages</option>)}
              </select>
              <button onClick={previewSet} disabled={planning || seed.trim().length < 2} className="gv-ghost"
                style={{ flex: 1, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '9px', borderRadius: 10, cursor: 'pointer' }}>
                {planning ? 'Planning…' : 'Preview set'}
              </button>
            </div>
            {pseoErr && <p style={errText}>{pseoErr}</p>}
          </div>
        )}
      </section>

      {/* ── Idea results ─────────────────────────────────────── */}
      {mode === 'idea' && ideas.length > 0 && (
        <section style={card}>
          <div style={kicker}>Pick one to write yourself, or hand it off</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ideas.map((idea, i) => {
              const busy = busyIdea === idea;
              return (
                <div key={i} style={ideaRow}>
                  <span style={{ fontSize: 14, lineHeight: 1.4, color: '#eef1ea', flex: 1, minWidth: 0 }}>{idea}</span>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => writeMine(idea)} disabled={!!busyIdea} className="gv-ghost"
                      title="Open a draft with this title and write it yourself"
                      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {busy && busyKind === 'mine' ? 'Opening…' : 'Write myself'}
                    </button>
                    <button onClick={() => groveWrites(idea)} disabled={!!busyIdea} className="gv-btn"
                      title="Let grove research and draft this one"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <Icon name="sparkle" size={12} />{busy && busyKind === 'grove' ? 'Queuing…' : 'grove writes it'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── SEO preview ──────────────────────────────────────── */}
      {mode === 'seo' && pages.length > 0 && (
        <section style={card}>
          <div style={kicker}>{pages.length} pages planned — review before generating</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pages.map((p, i) => (
              <div key={i} style={ideaRow}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: intentColor(p.intent) }} title={p.intent} />
                <span style={{ fontSize: 14, lineHeight: 1.4, color: '#eef1ea', flex: 1, minWidth: 0 }}>
                  {p.title}
                  <span style={{ display: 'block', fontSize: 11.5, color: '#9aa096', marginTop: 2 }}>targets “{p.keyword}” · {p.intent}</span>
                </span>
              </div>
            ))}
          </div>
          <button onClick={generateSet} disabled={generating} className="gv-btn"
            style={{ ...primaryBtn, marginTop: 14 }}>
            <span style={{ display: 'flex' }}><Icon name="sparkle" size={13} /></span>
            {generating ? `Drafting ${pages.length} pages…` : `Generate ${pages.length} pages`}
          </button>
          {generating && <p style={{ ...desc, marginTop: 8, marginBottom: 0 }}>This can take a minute or two — grove drafts each page one at a time.</p>}
        </section>
      )}
    </div>
  );
}

function intentColor(intent: SearchIntent): string {
  return intent === 'transactional' ? ACCENT
    : intent === 'commercial' ? '#7B9EF0'
    : intent === 'navigational' ? '#9aa096'
    : '#E0A040'; // informational
}

const card: React.CSSProperties = {
  background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '18px 18px 20px',
};
const iconBadge: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, background: 'rgba(99,194,129,0.14)', border: '1px solid rgba(99,194,129,0.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT,
};
const tabRow: React.CSSProperties = {
  display: 'flex', gap: 4, padding: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10, marginBottom: 16,
};
const kicker: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565a53', marginBottom: 8,
};
const desc: React.CSSProperties = {
  fontSize: 12.5, lineHeight: 1.5, color: '#9aa096', margin: '0 0 13px',
};
const field: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
  padding: '10px 12px', color: '#eef1ea', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', border: 'none',
  background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: 10,
  borderRadius: 10, cursor: 'pointer',
};
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#9aa096', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
};
const ideaRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10,
};
const errText: React.CSSProperties = { fontSize: 12.5, color: '#c97f7f', margin: '10px 0 0' };
