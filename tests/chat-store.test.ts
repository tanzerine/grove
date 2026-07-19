import { describe, it, expect } from 'vitest';
import {
  createChat, upsertChat, removeChat, parseChats, chatTitle, relativeTime,
  CHAT_LIMITS, type Chat,
} from '../lib/assistant/chat-store';

const chatAt = (id: string, updatedAt: number, msgCount = 2): Chat => ({
  id, createdAt: updatedAt, updatedAt,
  messages: Array.from({ length: msgCount }, (_, i) => ({
    role: i % 2 === 0 ? 'user' as const : 'agent' as const, content: `m${i}`,
  })),
});

describe('chatTitle', () => {
  it('uses the first user message, collapsed and truncated', () => {
    expect(chatTitle({ messages: [{ role: 'user', content: '  why   is\ntraffic down? ' }] }))
      .toBe('why is traffic down?');
    const long = 'x'.repeat(CHAT_LIMITS.titleChars + 20);
    expect(chatTitle({ messages: [{ role: 'user', content: long }] }).length)
      .toBeLessThanOrEqual(CHAT_LIMITS.titleChars);
  });

  it('skips agent messages and falls back for empty chats', () => {
    expect(chatTitle({ messages: [{ role: 'agent', content: 'hello!' }, { role: 'user', content: 'hi' }] })).toBe('hi');
    expect(chatTitle({ messages: [] })).toBe('New chat');
  });
});

describe('upsertChat', () => {
  it('inserts newest-first and replaces by id', () => {
    let list = upsertChat([], chatAt('a', 100));
    list = upsertChat(list, chatAt('b', 200));
    expect(list.map((c) => c.id)).toEqual(['b', 'a']);
    // touching "a" moves it to the front
    list = upsertChat(list, chatAt('a', 300));
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    expect(list).toHaveLength(2);
  });

  it('keeps empty chats out of storage', () => {
    const list = upsertChat([chatAt('a', 100)], createChat());
    expect(list.map((c) => c.id)).toEqual(['a']);
  });

  it('caps chats and per-chat messages', () => {
    let list: Chat[] = [];
    for (let i = 0; i < CHAT_LIMITS.chats + 4; i++) list = upsertChat(list, chatAt(`c${i}`, i));
    expect(list).toHaveLength(CHAT_LIMITS.chats);
    expect(list[0].id).toBe(`c${CHAT_LIMITS.chats + 3}`);   // newest survives

    const big = chatAt('big', 999, CHAT_LIMITS.messagesPerChat + 10);
    const trimmed = upsertChat([], big)[0];
    expect(trimmed.messages).toHaveLength(CHAT_LIMITS.messagesPerChat);
    expect(trimmed.messages.at(-1)?.content).toBe(big.messages.at(-1)?.content); // newest kept
  });
});

describe('removeChat / parseChats', () => {
  it('removes by id', () => {
    expect(removeChat([chatAt('a', 1), chatAt('b', 2)], 'a').map((c) => c.id)).toEqual(['b']);
  });

  it('parseChats survives garbage from localStorage', () => {
    expect(parseChats(null)).toEqual([]);
    expect(parseChats('nonsense')).toEqual([]);
    expect(parseChats([{ id: 'ok', createdAt: 1, updatedAt: 2, messages: [] }, { bad: true }, 42]))
      .toHaveLength(1);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  it('buckets sensibly', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86400_000, now)).toBe('2d ago');
    expect(relativeTime(now - 30 * 86400_000, now)).toBe('2026-06-19');
  });
});
