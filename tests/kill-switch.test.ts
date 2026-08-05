import { describe, it, expect } from 'vitest';
import { envPaused, pauseStateFrom, pausedMessage, NOT_PAUSED } from '../lib/kill-switch';

describe('envPaused', () => {
  it('accepts the spellings someone actually types under pressure', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ', 'True']) {
      expect(envPaused(v), v).toBe(true);
    }
  });

  it('treats absent, empty and unrecognised values as not paused', () => {
    // The empty string matters specifically: that is what Vercel hands back for
    // an env var that exists but was never given a value. A typo must not be
    // able to halt the platform by accident.
    for (const v of [undefined, null, '', '   ', '0', 'false', 'no', 'off', 'paused']) {
      expect(envPaused(v), String(v)).toBe(false);
    }
  });
});

describe('pauseStateFrom', () => {
  it('is not paused when neither lever is engaged', () => {
    expect(pauseStateFrom({ enabled: false }, undefined)).toEqual(NOT_PAUSED);
    expect(pauseStateFrom(null, undefined)).toEqual(NOT_PAUSED);
  });

  it('pauses on the database flag', () => {
    const s = pauseStateFrom({ enabled: true, note: 'runaway spend, ask Tae' }, undefined);
    expect(s.paused).toBe(true);
    expect(s.source).toBe('db');
    expect(s.note).toBe('runaway spend, ask Tae');
  });

  it('pauses on the env backstop even when the row says otherwise', () => {
    // The backstop exists for when the database is the thing that is wrong, so
    // a readable row claiming "not paused" must not be able to override it.
    const s = pauseStateFrom({ enabled: false }, '1');
    expect(s.paused).toBe(true);
    expect(s.source).toBe('env');
  });

  it('pauses on the env backstop when the row could not be read at all', () => {
    const s = pauseStateFrom(null, 'true');
    expect(s.paused).toBe(true);
    expect(s.source).toBe('env');
  });

  it('is not paused when the flag row is missing entirely', () => {
    // Pre-migration, or the seed row deleted. Must read as "running" — the
    // alternative is a platform that halts itself on a schema gap.
    expect(pauseStateFrom(undefined, undefined).paused).toBe(false);
  });

  it('does not treat a non-boolean enabled as engaged', () => {
    expect(pauseStateFrom({ enabled: null }, undefined).paused).toBe(false);
    expect(pauseStateFrom({ enabled: undefined }, undefined).paused).toBe(false);
  });
});

describe('pausedMessage', () => {
  it('appends the operator note when there is one', () => {
    const m = pausedMessage({ paused: true, source: 'db', note: 'back by 09:00 KST' });
    expect(m).toContain('back by 09:00 KST');
  });

  it('reads cleanly with no note', () => {
    const m = pausedMessage({ paused: true, source: 'env', note: null });
    expect(m).not.toContain('(');
    expect(m).toMatch(/paused/i);
  });

  it('ignores a note that is only whitespace', () => {
    expect(pausedMessage({ paused: true, source: 'db', note: '   ' })).not.toContain('(');
  });

  it('promises queued work resumes, which is what the crons actually do', () => {
    expect(pausedMessage({ paused: true, source: 'db', note: null })).toMatch(/resume/i);
  });
});
