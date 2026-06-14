'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '6px 0 14px' }}>
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
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '6px 0 14px' }}>
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
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--moss)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; }}
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

        {err && <p style={{ fontSize: 12.5, color: '#c33', marginTop: 10 }}>{err}</p>}

        {/* ideas */}
        {ideas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {ideas.map((idea, i) => {
              const busy = busyIdea === idea;
              return (
                <div key={i} style={ideaRow}>
                  <span style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--ink)', flex: 1 }}>{idea}</span>
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
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 24px',
};
const cardKicker: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)',
};
const field: React.CSSProperties = {
  padding: '12px 16px', border: '1px solid var(--line)', borderRadius: 10,
  background: 'white', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)', outline: 'none',
};
const chip: React.CSSProperties = {
  background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 999,
  padding: '7px 13px', fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer',
  fontFamily: 'inherit', transition: 'border-color .12s',
};
const ideaRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10,
};
