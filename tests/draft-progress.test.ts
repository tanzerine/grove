import { describe, it, expect } from 'vitest';
import { draftProgress, STALL_HINT_MS } from '../lib/pipeline/progress';

const NOW = 1_800_000_000_000;

describe('draftProgress', () => {
  it('reads a just-queued post as queued, not stalled', () => {
    const p = draftProgress({ status: 'queued', generation_log: [{ ts: NOW - 1_000, step: 'queued' }] }, NOW);
    expect(p.phase).toBe('queued');
    expect(p.stalled).toBe(false);
    expect(p.label).toMatch(/queued/i);
  });

  it('names the step a live run is on', () => {
    const log = [
      { ts: NOW - 20_000, step: 'queued' },
      { ts: NOW - 10_000, step: 'research' },
      { ts: NOW - 2_000, step: 'writer' },
    ];
    const p = draftProgress({ status: 'writing', generation_log: log }, NOW);
    expect(p.phase).toBe('working');
    expect(p.label).toMatch(/writing the article/i);
    expect(p.stalled).toBe(false);
  });

  it('falls back to the queued label for a step it does not know', () => {
    const p = draftProgress({ status: 'researching', generation_log: [{ ts: NOW, step: 'sorcery' }] }, NOW);
    expect(p.label).toMatch(/queued/i);
  });

  it('calls an in-flight post with a silent log overdue', () => {
    const log = [{ ts: NOW - STALL_HINT_MS - 1, step: 'writer' }];
    const p = draftProgress({ status: 'writing', generation_log: log }, NOW);
    expect(p.stalled).toBe(true);
    expect(p.phase).toBe('working');
    expect(p.label).toMatch(/next run/i);
  });

  it('treats an in-flight post with no log at all as overdue', () => {
    // A live generation always seeds a timestamp, so an empty log means the run
    // never really started (or was killed before its first write).
    expect(draftProgress({ status: 'queued', generation_log: [] }, NOW).stalled).toBe(true);
    expect(draftProgress({ status: 'queued' }, NOW).stalled).toBe(true);
  });

  it('is ready once the draft lands in review with words', () => {
    const p = draftProgress({ status: 'review', body_md: '# Title\n\nSome words.' }, NOW);
    expect(p.phase).toBe('ready');
    expect(p.hasDraft).toBe(true);
    expect(p.label).toMatch(/ready/i);
  });

  it('does not claim a draft exists when review has no body', () => {
    const p = draftProgress({ status: 'review', body_md: '   ' }, NOW);
    expect(p.phase).toBe('ready');
    expect(p.hasDraft).toBe(false);
  });

  it('reports the terminal states plainly', () => {
    expect(draftProgress({ status: 'failed' }, NOW).phase).toBe('failed');
    expect(draftProgress({ status: 'scheduled', body_md: 'x' }, NOW).phase).toBe('scheduled');
    expect(draftProgress({ status: 'published', body_md: 'x' }, NOW).phase).toBe('live');
  });

  it('never reports a terminal state as stalled, however old the log', () => {
    const log = [{ ts: NOW - 10 * STALL_HINT_MS, step: 'writer' }];
    for (const status of ['failed', 'scheduled', 'published', 'review']) {
      expect(draftProgress({ status, generation_log: log, body_md: 'x' }, NOW).stalled).toBe(false);
    }
  });
});
