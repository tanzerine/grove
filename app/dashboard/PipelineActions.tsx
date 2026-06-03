'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SparkleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
    <path d="M6.5 1l1.2 3.3L11 6.5l-3.3 1.2L6.5 11 5.3 7.7 2 6.5l3.3-1.2L6.5 1z" fill="currentColor" />
  </svg>
);

export default function PipelineActions({ domainId }: { domainId?: string }) {
  const r = useRouter();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggErr, setSuggErr] = useState(false);

  async function enqueue() {
    if (!domainId || !topic.trim()) return;
    setBusy(true);
    await fetch('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, topic }),
    });
    setBusy(false);
    setTopic('');
    setSuggestions([]);
    r.refresh();
  }

  async function suggest() {
    if (!domainId) return;
    setSuggesting(true);
    setSuggErr(false);
    try {
      const res = await fetch(`/api/topics/suggest?domain_id=${domainId}`);
      if (!res.ok) throw new Error();
      const { suggestions: s } = await res.json();
      setSuggestions(s ?? []);
    } catch {
      setSuggErr(true);
    }
    setSuggesting(false);
  }

  function pick(t: string) {
    setTopic(t);
    setSuggestions([]);
  }

  return (
    <div style={{ marginTop: 24 }}>
      {/* Input row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enqueue()}
          placeholder="Add a topic… e.g. 'how to reduce churn with onboarding nudges'"
          style={{
            flex: 1, padding: '12px 16px',
            border: '1px solid var(--line)', borderRadius: 10,
            background: 'white', fontFamily: 'inherit', fontSize: 14,
          }}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={suggest}
          disabled={suggesting || !domainId}
          title="AI topic recommendations"
          style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <SparkleIcon />
          {suggesting ? 'Thinking…' : 'Suggest'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={enqueue}
          disabled={busy || !topic.trim()}
        >
          {busy ? '…' : 'Queue topic'}
        </button>
      </div>

      {/* Error state */}
      {suggErr && (
        <p style={{ fontSize: 12, color: '#c33', marginTop: 8 }}>
          Could not generate suggestions — make sure the site profile is built first.
        </p>
      )}

      {/* Suggestion chips */}
      {suggestions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 11, color: 'var(--clay)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Click a topic to use it
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => pick(s)}
                style={{
                  textAlign: 'left', padding: '10px 14px',
                  background: 'white', border: '1px solid var(--line)',
                  borderRadius: 8, fontSize: 13.5, color: 'var(--ink)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background .12s, border-color .12s',
                  lineHeight: 1.4,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--paper)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--moss)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'white';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)';
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={suggest}
            disabled={suggesting}
            style={{
              marginTop: 8, fontSize: 12, color: 'var(--moss)',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <SparkleIcon /> Refresh suggestions
          </button>
        </div>
      )}
    </div>
  );
}
