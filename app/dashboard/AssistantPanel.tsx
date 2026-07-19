'use client';

/**
 * The multipurpose agent in the right sidebar — ask anything, anywhere in the
 * dashboard: "why is this month lacking new viewers?", "write an article
 * about X", "how do I set up the canonical URL?". Slash commands scope the
 * question (/analytics /write /strategy /help); replies show the agent's
 * one-line "Thought · Ns" and, when it actually did something (queued an
 * article), a Changes card linking to the affected surface.
 *
 * Chat maintenance: conversations are kept per domain in localStorage
 * (rules in lib/assistant/chat-store.ts) so they survive refreshes — the
 * panel reopens on the most recent chat, "New" starts a fresh one, and the
 * history view lists past chats to reopen or delete. The server stays
 * stateless: the active transcript rides along with each request.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from './gv-icons';
import { useChrome } from './chrome-context';
import { SLASH_COMMANDS } from '@/lib/assistant/triage';
import {
  createChat, upsertChat, removeChat, parseChats, chatTitle, relativeTime, type Chat,
} from '@/lib/assistant/chat-store';
import { parseChatText, type ChatSpan } from '@/lib/assistant/chat-format';

const ACCENT = 'var(--gv-accent)';

type Change = { label: string; detail: string; href: string };
type LinkChip = { label: string; href: string };
type UndoItem = { post_id: string; from: string; to: string };
type Msg =
  | { role: 'user'; content: string }
  | { role: 'agent'; content: string; thought?: string; thoughtSec?: number; changes?: Change[]; links?: LinkChip[]; undo?: UndoItem[]; undone?: boolean };

const SUGGESTIONS = [
  '/analytics What’s actually driving clicks this month?',
  '/write an article about ',
  '/help How do I set up the canonical URL?',
];

const iconFor = (label: string) =>
  ({ Pipeline: 'pipeline', Analytics: 'analytics', Strategy: 'strategy', Billing: 'billing', Titles: 'pen', Published: 'published', Calendar: 'calendar' } as Record<string, string>)[label] ?? 'link';

/** Agent replies come as markdown-lite (**bold**, `code`, lists) — render
 *  them as real elements instead of literal asterisks. Parsing is pure
 *  (lib/assistant/chat-format.ts); this just maps blocks to React nodes. */
function ChatText({ text }: { text: string }) {
  const spansOf = (spans: ChatSpan[]) => spans.map((s, j) => s.code
    ? <code key={j} className="mono" style={{ fontSize: 11.5, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 5 }}>{s.text}</code>
    : s.bold
      ? <b key={j} style={{ color: 'var(--gv-ink)' }}>{s.text}</b>
      : <span key={j}>{s.text}</span>);
  return (
    <>
      {parseChatText(text).map((b, i) => {
        if (b.kind === 'p' && b.spans.length === 0) return <div key={i} style={{ height: 7 }} />;
        if (b.kind === 'bullet') {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0' }}>
              <span style={{ color: ACCENT, flexShrink: 0 }}>•</span>
              <span style={{ flex: 1, minWidth: 0 }}>{spansOf(b.spans)}</span>
            </div>
          );
        }
        if (b.kind === 'num') {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0' }}>
              <span style={{ color: ACCENT, flexShrink: 0, minWidth: 15, textAlign: 'right' }}>{b.num}.</span>
              <span style={{ flex: 1, minWidth: 0 }}>{spansOf(b.spans)}</span>
            </div>
          );
        }
        return <div key={i} style={{ margin: '2px 0' }}>{spansOf(b.spans)}</div>;
      })}
    </>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
  color: 'var(--gv-dim)', cursor: 'pointer',
};

export default function AssistantPanel() {
  const { activeId, activeHostname } = useChrome();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [chats, setChats] = useState<Chat[]>([]);
  const [chat, setChat] = useState<Chat>(() => createChat());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const chatsKey = `gv-assist-chats:${activeId ?? 'none'}`;
  const messages = chat.messages as Msg[];
  const patchMessages = (fn: (m: Msg[]) => Msg[]) =>
    setChat((c) => ({ ...c, messages: fn(c.messages as Msg[]), updatedAt: Date.now() }));

  // Hydration-safe restore: open state, then the domain's chat list — the
  // panel resumes on the most recent conversation.
  useEffect(() => {
    try { setOpen(localStorage.getItem('gv-assist-open') === '1'); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    let list: Chat[] = [];
    try { list = parseChats(JSON.parse(localStorage.getItem(chatsKey) ?? '[]')); } catch { /* ignore */ }
    // One-time migration of the old single-transcript sessionStorage key.
    try {
      const legacyKey = `gv-assist:${activeId ?? 'none'}`;
      const legacy = JSON.parse(sessionStorage.getItem(legacyKey) ?? 'null');
      if (Array.isArray(legacy) && legacy.length) {
        list = upsertChat(list, { ...createChat(), messages: legacy });
        sessionStorage.removeItem(legacyKey);
      }
    } catch { /* ignore */ }
    setChats(list);
    setChat(list[0] ?? createChat());
    setView('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Persist the active chat into the list on every change.
  useEffect(() => {
    if (!activeId) return;
    setChats((prev) => {
      const next = upsertChat(prev, chat);
      try { localStorage.setItem(chatsKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, sending, open, view]);

  const toggle = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem('gv-assist-open', v ? '1' : '0'); } catch { /* ignore */ }
  };

  const startNewChat = () => {
    if (messages.length) setChat(createChat());
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 60);
  };

  const openChat = (c: Chat) => {
    setChat(c);
    setView('chat');
  };

  const deleteChatById = (id: string) => {
    setChats((prev) => {
      const next = removeChat(prev, id);
      try { localStorage.setItem(chatsKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (id === chat.id) setChat(createChat());
  };

  // "Ask the agent" buttons anywhere in the dashboard open the panel with a
  // prefilled prompt (not auto-sent — the owner stays in control).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt ?? '';
      toggle(true);
      setView('chat');
      if (prompt) setInput(prompt);
      setTimeout(() => inputRef.current?.focus(), 60);
    };
    window.addEventListener('gv:assistant', onAsk);
    return () => window.removeEventListener('gv:assistant', onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slash menu: typing "/" (before the first space completes a command) shows
  // the matching commands.
  const slashPrefix = /^\/([a-z]*)$/i.exec(input.trim());
  const slashMatches = slashPrefix
    ? SLASH_COMMANDS.filter((c) => c.command.startsWith(slashPrefix[1].toLowerCase()))
    : [];

  const send = async (raw?: string) => {
    const message = (raw ?? input).trim();
    if (!message || sending || !activeId) return;
    setInput('');
    setSending(true);
    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    patchMessages((m) => [...m, { role: 'user', content: message }]);
    const started = Date.now();
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: activeId, message, history }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'request failed');
      patchMessages((m) => [...m, {
        role: 'agent', content: d.reply,
        thought: d.thought || undefined,
        thoughtSec: Math.max(1, Math.round((Date.now() - started) / 1000)),
        changes: d.changes?.length ? d.changes : undefined,
        links: d.links?.length ? d.links : undefined,
        undo: d.undo?.length ? d.undo : undefined,
      }]);
      if (d.changes?.length) router.refresh();   // e.g. pipeline badge just grew
    } catch {
      patchMessages((m) => [...m, { role: 'agent', content: 'Something went wrong — nothing was changed. Try again in a moment.' }]);
    } finally {
      setSending(false);
    }
  };

  // Revert an action (title rewrites): restore the old titles, mark the
  // message so the button reads "Undone" and can't fire twice.
  const undoAction = async (index: number) => {
    const msg = messages[index];
    if (!msg || msg.role !== 'agent' || !msg.undo || msg.undone || !activeId) return;
    const revert = msg.undo.map((u) => ({ post_id: u.post_id, title: u.from }));
    try {
      const res = await fetch('/api/assistant/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: activeId, revert }),
      });
      if (!res.ok) throw new Error('undo failed');
      patchMessages((m) => m.map((x, i) => (i === index ? { ...x, undone: true } : x)));
      router.refresh();
    } catch {
      patchMessages((m) => [...m, { role: 'agent', content: 'Undo failed — you can still restore titles by hand in the editor.' }]);
    }
  };

  if (!activeId) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="gv-assist-fab gv-btn"
          aria-label="Open agent chat"
          onClick={() => toggle(true)}
        >
          <Icon name="sparkle" size={19} />
        </button>
      )}

      <aside className={`gv-assist gv-scroll ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: ACCENT, display: 'flex' }}><Icon name="sparkle" size={16} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Agent</div>
            <div style={{ fontSize: 10.5, color: 'var(--gv-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeHostname}</div>
          </div>
          <button
            type="button"
            className="gv-ghost"
            onClick={startNewChat}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid rgba(99,194,129,0.3)', background: 'rgba(99,194,129,0.06)', color: ACCENT, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <Icon name="pen" size={12} /> New chat
          </button>
          <button
            type="button"
            className="gv-iconbtn"
            aria-label="Chat history"
            title="Chat history"
            aria-pressed={view === 'history'}
            onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
            style={{ ...iconBtnStyle, ...(view === 'history' ? { borderColor: 'rgba(99,194,129,0.45)', color: ACCENT } : {}) }}
          >
            <Icon name="clock" size={13} />
          </button>
          <button
            type="button"
            className="gv-iconbtn"
            aria-label="Close agent chat"
            onClick={() => toggle(false)}
            style={iconBtnStyle}
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {view === 'history' ? (
          /* ── chat history: reopen or delete past conversations ─────────── */
          <div className="gv-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {chats.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--gv-faint)', padding: '8px 2px', lineHeight: 1.6 }}>
                No past chats yet for {activeHostname}. Conversations are saved here automatically.
              </div>
            )}
            {chats.map((c) => (
              <div
                key={c.id}
                className="gv-prow"
                role="button"
                tabIndex={0}
                onClick={() => openChat(c)}
                onKeyDown={(e) => { if (e.key === 'Enter') openChat(c); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${c.id === chat.id ? 'rgba(99,194,129,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 11, padding: '10px 12px', cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--gv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chatTitle(c)}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--gv-faint)', marginTop: 2 }}>
                    {relativeTime(c.updatedAt)} · {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  type="button"
                  className="gv-iconbtn"
                  aria-label="Delete chat"
                  title="Delete chat"
                  onClick={(e) => { e.stopPropagation(); deleteChatById(c.id); }}
                  style={{ ...iconBtnStyle, width: 26, height: 26, flexShrink: 0 }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* ── active conversation ────────────────────────────────────────── */
          <div ref={scrollRef} className="gv-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {messages.length === 0 && (
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.6 }}>
                  Ask me anything about your blog — traffic, the plan, setup — or tell me to write something.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 14 }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="gv-sugg"
                      onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      style={{ textAlign: 'left', fontSize: 12, color: 'var(--gv-soft)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <b style={{ color: ACCENT }}>{s.split(' ')[0]}</b>{s.slice(s.indexOf(' '))}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '10px 13px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--gv-ink)', background: 'rgba(255,255,255,0.025)' }}>
                {/^\/[a-z]+/i.test(m.content)
                  ? <><b style={{ color: ACCENT }}>{m.content.split(' ')[0]}</b>{m.content.slice(m.content.indexOf(' ') > -1 ? m.content.indexOf(' ') : m.content.length)}</>
                  : m.content}
              </div>
            ) : (
              <div key={i}>
                {m.thought && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--gv-fainter)', letterSpacing: '0.02em' }}>Thought · {m.thoughtSec ?? 1}s</div>
                    <div style={{ fontSize: 12, color: 'var(--gv-faint)', lineHeight: 1.55, marginTop: 4 }}>{m.thought}</div>
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: 'var(--gv-soft)', lineHeight: 1.6 }}><ChatText text={m.content} /></div>

                {m.changes && (
                  <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700 }}>Changes</div>
                      {m.undo && (
                        <button
                          type="button"
                          onClick={() => undoAction(i)}
                          disabled={m.undone}
                          style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 11.5, color: m.undone ? 'var(--gv-fainter)' : 'var(--gv-dim)', cursor: m.undone ? 'default' : 'pointer', textDecoration: m.undone ? 'none' : 'underline', textUnderlineOffset: 3 }}
                        >
                          {m.undone ? 'Undone ✓' : 'Undo'}
                        </button>
                      )}
                    </div>
                    {m.changes.map((c) => (
                      <Link key={c.href + c.label} href={c.href} className="gv-prow" style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '10px 12px', marginBottom: 6, textDecoration: 'none' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,194,129,0.1)', color: ACCENT }}>
                          <Icon name={iconFor(c.label)} size={14} />
                        </span>
                        <span style={{ fontSize: 12.5, color: 'var(--gv-ink)' }}>{c.label}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--gv-faint)' }}>{c.detail}</span>
                      </Link>
                    ))}
                  </div>
                )}

                {m.links && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {m.links.map((l) => (
                      <Link key={l.href + l.label} href={l.href} className="gv-chip" style={{ fontSize: 11, color: 'var(--gv-dim)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 99, padding: '4px 10px', textDecoration: 'none' }}>
                        {l.label} →
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--gv-faint)' }}>
                <span className="gv-think" /><span className="gv-think" style={{ animationDelay: '.15s' }} /><span className="gv-think" style={{ animationDelay: '.3s' }} />
                thinking
              </div>
            )}
          </div>
        )}

        {/* composer (hidden while browsing history) */}
        {view === 'chat' && (
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
            {slashMatches.length > 0 && (
              <div style={{ position: 'absolute', bottom: '100%', left: 14, right: 14, marginBottom: 6, background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px rgba(0,0,0,0.45)' }}>
                {slashMatches.map((c) => (
                  <button
                    key={c.command}
                    type="button"
                    className="gv-row"
                    onClick={() => { setInput(`/${c.command} `); inputRef.current?.focus(); }}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 9, width: '100%', textAlign: 'left', padding: '9px 13px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <b style={{ fontSize: 12.5, color: ACCENT }}>/{c.command}</b>
                    <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>{c.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && slashMatches.length === 0) { e.preventDefault(); send(); } }}
                placeholder={messages.length ? 'Add follow up…' : 'Ask, or type / for commands…'}
                disabled={sending}
                style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: '10px 13px', fontSize: 12.5, color: 'var(--gv-ink)', fontFamily: 'inherit', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="gv-btn"
                style={{ border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', width: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: sending ? 'default' : 'pointer', opacity: sending || !input.trim() ? 0.55 : 1 }}
              >
                <Icon name="send" size={14} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
