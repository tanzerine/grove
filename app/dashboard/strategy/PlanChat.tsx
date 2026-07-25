'use client';

/**
 * Plan chat — the owner talks to the strategist about the active plan.
 * Questions are answered from the plan memo (cheap path); change requests
 * revise the plan in place and refresh the page so every chart re-renders
 * from the new strategy row. Budget comes from the API so the UI always
 * shows the real remaining revision count.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

type Msg = { id?: string; role: 'user' | 'agent'; content: string; revised?: boolean };
type Budget = { messagesLeft: number; revisionsLeft: number };

export default function PlanChat({ domainId }: { domainId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/strategy/chat?domain_id=${domainId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setMessages(d.messages ?? []); setBudget(d.budget ?? null); } })
      .catch(() => {});
  }, [domainId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { role: 'user', content: message }]);
    try {
      const res = await fetch('/api/strategy/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, message }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'request failed');
      setMessages((m) => [...m, { role: 'agent', content: d.reply, revised: d.revised }]);
      if (d.budget) setBudget(d.budget);
      if (d.revised) router.refresh();   // plan changed — re-render the whole page from the new row
    } catch {
      setMessages((m) => [...m, { role: 'agent', content: 'Something went wrong — the plan is unchanged. Try again in a moment.' }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Talk to your strategist</div>
          <div style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 3 }}>
            Ask why the plan looks this way — or tell it what to change (&ldquo;add two more conversion posts&rdquo;, &ldquo;drop the pricing pillar&rdquo;) and it updates instantly.
          </div>
        </div>
        {budget && (
          <span style={{ fontSize: 11.5, color: budget.revisionsLeft > 0 ? 'var(--gv-dim)' : 'var(--gv-red)', whiteSpace: 'nowrap' }}>
            {budget.revisionsLeft} plan change{budget.revisionsLeft === 1 ? '' : 's'} left this month
          </span>
        )}
      </div>

      {messages.length > 0 && (
        <div ref={scrollRef} style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0 0', paddingRight: 4 }}>
          {messages.map((m, i) => (
            <div key={m.id ?? i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div style={{
                padding: '9px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'rgba(162,255,1,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${m.role === 'user' ? 'rgba(162,255,1,0.25)' : 'var(--gv-line)'}`,
                color: 'var(--gv-soft)',
              }}>
                {m.content}
              </div>
              {m.revised && (
                <div style={{ fontSize: 10.5, color: ACCENT_INK, marginTop: 3, textAlign: 'left' }}>✓ plan updated</div>
              )}
            </div>
          ))}
          {sending && <div style={{ fontSize: 12, color: 'var(--gv-faint)', padding: '4px 2px' }}>thinking…</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about the plan, or tell me what to change…"
          disabled={sending}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, padding: '11px 14px', fontSize: 13, color: 'var(--gv-ink)', fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="gv-btn"
          style={{
            border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13,
            fontWeight: 700, padding: '11px 18px', borderRadius: 10, cursor: sending ? 'default' : 'pointer',
            opacity: sending || !input.trim() ? 0.55 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
