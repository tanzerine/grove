/**
 * Chat persistence rules for the assistant panel — pure and client-safe
 * (no window/localStorage access here; the panel owns the I/O). Chats are
 * kept per domain in localStorage so they survive page refreshes, newest
 * first, with hard caps so storage can't grow without bound. Unit-tested.
 */

export type StoredMessage = { role: 'user' | 'agent'; content: string };

export type Chat = {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
};

export const CHAT_LIMITS = {
  chats: 12,            // per domain
  messagesPerChat: 40,
  titleChars: 44,
} as const;

export function createChat(now = Date.now()): Chat {
  const id = `c${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return { id, createdAt: now, updatedAt: now, messages: [] };
}

/** List title: the first user message, whitespace-collapsed and truncated. */
export function chatTitle(chat: Pick<Chat, 'messages'>): string {
  const first = chat.messages.find((m) => m.role === 'user')?.content ?? '';
  const t = first.replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  return t.length <= CHAT_LIMITS.titleChars
    ? t
    : `${t.slice(0, CHAT_LIMITS.titleChars - 1).trimEnd()}…`;
}

/**
 * Write `chat` into the list: replace by id or insert, newest-activity
 * first, message cap applied. Empty chats never reach storage (an untouched
 * "New chat" must not clutter the history), and the oldest chats fall off
 * past the cap.
 */
export function upsertChat(chats: Chat[], chat: Chat): Chat[] {
  const rest = chats.filter((c) => c.id !== chat.id);
  const trimmed = { ...chat, messages: chat.messages.slice(-CHAT_LIMITS.messagesPerChat) };
  const next = trimmed.messages.length ? [trimmed, ...rest] : rest;
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next.slice(0, CHAT_LIMITS.chats);
}

export function removeChat(chats: Chat[], id: string): Chat[] {
  return chats.filter((c) => c.id !== id);
}

/** Coerce whatever came out of localStorage into a valid chat list. */
export function parseChats(raw: unknown): Chat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Chat =>
      !!c && typeof c === 'object' &&
      typeof (c as Chat).id === 'string' &&
      typeof (c as Chat).createdAt === 'number' &&
      typeof (c as Chat).updatedAt === 'number' &&
      Array.isArray((c as Chat).messages))
    .slice(0, CHAT_LIMITS.chats);
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / date past a week. */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}
