'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchIntent } from '@/lib/strategy/keywords';

const Sparkle = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
    <path d="M6.5 1l1.2 3.3L11 6.5l-3.3 1.2L6.5 11 5.3 7.7 2 6.5l3.3-1.2L6.5 1z" fill="currentColor" />
  </svg>
);

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

export default function WriteDesk({ domainId, hostname }: { domainId: string; hostname: string }) {
  const r = useRouter();

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 28 }}>

      {/* ── Blank draft ─────────────────────────────────────── */}
      <section style={card}>
        <div className="mono" style={cardKicker}>START FROM A BLANK PAGE</div>
        <p style={{ fontSize: 14, color: '#9aa096', margin: '6px 0 14px' }}>
          Open the editor and write it yourself. You can name it now or later.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={blankTitle}
            onChange={(e) => setBlankTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && openBlank()}
            placeholder="Working title (optional)"
            style={{ ...field, flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-primary btn-sm" onClick={openBlank} disabled={opening}>
            {opening ? 'Opening…' : 'Open blank editor →'}
          </button>
        </div>
      </section>

      {/* ── Idea studio ─────────────────────────────────────── */}
      <section style={card}>
        <div className="mono" style={cardKicker}>IDEA STUDIO</div>
        <p style={{ fontSize: 14, color: '#9aa096', margin: '6px 0 14px' }}>
          Not sure what to write about? Give grove a nudge — a theme, a product, a question on your
          mind — and it&apos;ll suggest angles for <b>{hostname}</b>. Pick one to write yourself, or hand it off.
        </p>

        {/* thinking prompts */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {PROMPTS.map((p) => (
            <button
              key={p.label}
              onClick={() => setFocus(p.seed)}
              style={chip}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#63c281'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* focus input */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate()}
            placeholder="What's on your mind? (optional) — a theme, product, or question"
            style={{ ...field, flex: 1, minWidth: 240 }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={generate}
            disabled={thinking}
            style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          >
            <Sparkle />{thinking ? 'Thinking…' : ideas.length ? 'More ideas' : 'Generate ideas'}
          </button>
        </div>

        {err && <p style={{ fontSize: 12.5, color: '#c97f7f', marginTop: 10 }}>{err}</p>}

        {/* ideas */}
        {ideas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {ideas.map((idea, i) => {
              const busy = busyIdea === idea;
              return (
                <div key={i} style={ideaRow}>
                  <span style={{ fontSize: 14, lineHeight: 1.4, color: '#eef1ea', flex: 1 }}>{idea}</span>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => writeMine(idea)}
                      disabled={!!busyIdea}
                      title="Open a draft with this title and write it yourself"
                    >
                      {busy && busyKind === 'mine' ? 'Opening…' : 'Write myself'}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => groveWrites(idea)}
                      disabled={!!busyIdea}
                      title="Let grove research and draft this one"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                    >
                      <Sparkle />{busy && busyKind === 'grove' ? 'Queuing…' : 'grove writes it'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Programmatic SEO ────────────────────────────────── */}
      <section style={card}>
        <div className="mono" style={cardKicker}>PROGRAMMATIC SEO · GENERATE A SET</div>
        <p style={{ fontSize: 14, color: '#9aa096', margin: '6px 0 14px' }}>
          Cover a whole topic at once. Give a seed term — grove finds the real searches around it
          and drafts one focused page per query. Each lands in your pipeline for review, and they
          cross-link automatically once published.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && seed.trim().length >= 2 && previewSet()}
            placeholder="Seed term — e.g. 'cold brew', 'email deliverability', 'tax deductions'"
            style={{ ...field, flex: 1, minWidth: 240 }}
          />
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ ...field, paddingRight: 10, cursor: 'pointer' }}
            aria-label="Number of pages"
          >
            {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} pages</option>)}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={previewSet}
            disabled={planning || seed.trim().length < 2}
            style={{ whiteSpace: 'nowrap' }}
          >
            {planning ? 'Planning…' : 'Preview set'}
          </button>
        </div>

        {pseoErr && <p style={{ fontSize: 12.5, color: '#c97f7f', marginTop: 10 }}>{pseoErr}</p>}

        {pages.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, color: '#9aa096', margin: '0 0 8px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {pages.length} pages planned — review before generating
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pages.map((p, i) => (
                <div key={i} style={ideaRow}>
                  <span style={{ ...intentDot, background: intentColor(p.intent) }} title={p.intent} />
                  <span style={{ fontSize: 14, lineHeight: 1.4, color: '#eef1ea', flex: 1 }}>
                    {p.title}
                    <span style={{ display: 'block', fontSize: 11.5, color: '#9aa096', marginTop: 2 }}>
                      targets “{p.keyword}” · {p.intent}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={generateSet}
              disabled={generating}
              style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Sparkle />{generating ? `Drafting ${pages.length} pages…` : `Generate ${pages.length} pages →`}
            </button>
            {generating && (
              <p style={{ fontSize: 12, color: '#9aa096', marginTop: 8 }}>
                This can take a minute or two — grove drafts each page one at a time.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function intentColor(intent: SearchIntent): string {
  return intent === 'transactional' ? '#63c281'
    : intent === 'commercial' ? '#7B9EF0'
    : intent === 'navigational' ? '#9aa096'
    : '#E0A040'; // informational
}

const card: React.CSSProperties = {
  background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '22px 24px',
};
const cardKicker: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.1em', color: '#6b6f67',
};
const field: React.CSSProperties = {
  padding: '12px 16px', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10,
  background: 'rgba(255,255,255,0.03)', fontFamily: 'inherit', fontSize: 14, color: '#eef1ea', outline: 'none',
};
const chip: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999,
  padding: '7px 13px', fontSize: 12.5, color: '#cdd2c9', cursor: 'pointer',
  fontFamily: 'inherit', transition: 'border-color .12s',
};
const ideaRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10,
};
const intentDot: React.CSSProperties = {
  width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
};
