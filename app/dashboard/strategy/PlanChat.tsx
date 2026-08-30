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
import Icon from '../gv-icons';
import { captureClient } from '@/lib/analytics/capture-client';
import { useT } from '../i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

type Msg = { id?: string; role: 'user' | 'agent'; content: string; revised?: boolean };
type Budget = { messagesLeft: number; revisionsLeft: number };

/** Messages kept on screen when the history is collapsed — the last exchange. */
const LATEST_COUNT = 2;
/** Characters past which a bubble is clamped behind a "Show more". */
const CLAMP_AT = 260;

/** One message. Long replies clamp to a few lines so a verbose plan revision
 *  can't push the input field off the screen. */
function Bubble({ msg }: { msg: Msg }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = msg.content.length > CLAMP_AT;
  const mine = msg.role === 'user';
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      <div style={{
        padding: '9px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
        background: mine ? 'rgba(162,255,1,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${mine ? 'rgba(162,255,1,0.25)' : 'var(--gv-line)'}`,
        color: 'var(--gv-soft)',
        ...(long && !open
          ? { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }
          : null),
      }}>
        {msg.content}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
        {msg.revised && <span style={{ fontSize: 10.5, color: ACCENT_INK }}>✓ plan updated</span>}
        {long && (
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, color: 'var(--gv-faint)' }}
          >
            {open ? t('Show less') : t('Show more')}
          </button>
        )}
      </div>
    </div>
  );
}

/** `bare` drops the card chrome (background/border/padding) so the chat can sit
 *  inside another card — on the strategy page it lives at the foot of the
 *  monthly-brief hero, which already provides the surface. */
export default function PlanChat({ domainId, bare = false }: { domainId: string; bare?: boolean }) {
  const t = useT();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Only the last exchange is on screen by default — a strategist thread runs
  // for a whole month, and printing all of it turns the hero into a wall.
  // Everything older folds behind one line the owner can open.
  const latest = messages.slice(-LATEST_COUNT);
  const earlier = messages.slice(0, Math.max(0, messages.length - LATEST_COUNT));
  const revisionCount = earlier.filter((m) => m.revised).length;

  useEffect(() => {
    fetch(`/api/strategy/chat?domain_id=${domainId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setMessages(d.messages ?? []); setBudget(d.budget ?? null); } })
      .catch(() => {});
  }, [domainId]);

  useEffect(() => {
    if (open && showHistory) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open, showHistory]);

  // Links that point at the chat (#plan-chat) expect it open on arrival.
  useEffect(() => {
    const openOnHash = () => { if (window.location.hash === '#plan-chat') setOpen(true); };
    openOnHash();
    window.addEventListener('hashchange', openOnHash);
    return () => window.removeEventListener('hashchange', openOnHash);
  }, []);

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
      // `revised` separates "asked the agent a question" from "changed the
      // plan" — only the second one is the feature actually being used.
      captureClient('strategy_chat_message_sent', { domain_id: domainId, revised: !!d.revised });
      if (d.budget) setBudget(d.budget);
      if (d.revised) router.refresh();   // plan changed — re-render the whole page from the new row
    } catch {
      setMessages((m) => [...m, { role: 'agent', content: t('Something went wrong — the plan is unchanged. Try again in a moment.') }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={bare ? undefined : 'gv-card'}
      style={bare
        ? {}
        : { background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', marginTop: 14 }}
    >
      {/* The whole strategist thread is a disclosure: closed it costs one row,
          open it's a full conversation. Closed is the default — the plan, not
          the chat about it, is what the page is for. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="gv-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 0,
          background: 'none', border: 'none', color: 'inherit', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', color: 'var(--gv-dim)', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .18s' }}>
          <Icon name="arrow" size={14} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{t('Talk to your strategist')}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 3 }}>
            {open
              ? t('Ask why the plan looks this way, or tell it what to change.')
              : messages.length > 0
                ? `${messages.length} message${messages.length === 1 ? '' : 's'} in this month’s thread`
                : t('Ask why the plan looks this way, or tell it what to change.')}
          </span>
        </span>
        {budget && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: budget.revisionsLeft > 0 ? 'var(--gv-dim)' : 'var(--gv-red)', whiteSpace: 'nowrap' }}>
            {budget.revisionsLeft} plan change{budget.revisionsLeft === 1 ? '' : 's'} left
          </span>
        )}
      </button>

      {open && messages.length > 0 && (
        <div style={{ margin: '16px 0 0' }}>
          {earlier.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="gv-btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 7, width: '100%', marginBottom: 8, padding: '7px 11px',
                background: 'rgba(255,255,255,0.02)', border: '1px solid var(--gv-line)', borderRadius: 9,
                color: 'var(--gv-faint)', fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', transform: showHistory ? 'rotate(-90deg)' : 'rotate(90deg)' }}>
                <Icon name="arrow" size={12} />
              </span>
              {showHistory ? t('Hide earlier messages') : `${earlier.length} earlier message${earlier.length === 1 ? '' : 's'}`}
              {revisionCount > 0 && !showHistory && (
                <span style={{ marginLeft: 'auto', color: ACCENT_INK }}>
                  {revisionCount} plan change{revisionCount === 1 ? '' : 's'} made
                </span>
              )}
            </button>
          )}

          <div
            ref={scrollRef}
            style={{
              maxHeight: showHistory ? 300 : undefined, overflowY: showHistory ? 'auto' : 'visible',
              display: 'flex', flexDirection: 'column', gap: 8, paddingRight: showHistory ? 4 : 0,
            }}
          >
            {(showHistory ? messages : latest).map((m, i) => (
              <Bubble key={m.id ?? `${showHistory ? 'h' : 'l'}${i}`} msg={m} />
            ))}
            {sending && <div style={{ fontSize: 12, color: 'var(--gv-faint)', padding: '4px 2px' }}>thinking…</div>}
          </div>
        </div>
      )}

      <div style={{ display: open ? 'flex' : 'none', gap: 8, marginTop: 14 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={t('Ask about the plan, or tell me what to change…')}
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
          {t('Send')}
        </button>
      </div>
    </div>
  );
}
