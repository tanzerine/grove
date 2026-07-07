import { describe, it, expect } from 'vitest';
import { engagementStatus, fmtDuration, cohortRetention } from '../lib/admin-users';

const DAY = 86400_000;
// Tue 2026-07-07 noon UTC — its week starts Mon 2026-07-06.
const NOW = Date.parse('2026-07-07T12:00:00Z');

describe('engagementStatus', () => {
  it('buckets by recency of last-seen', () => {
    expect(engagementStatus(null, NOW)).toBe('never');
    expect(engagementStatus(NOW - 3600_000, NOW)).toBe('active');
    expect(engagementStatus(NOW - 7 * DAY, NOW)).toBe('active');   // boundary inclusive
    expect(engagementStatus(NOW - 10 * DAY, NOW)).toBe('cooling');
    expect(engagementStatus(NOW - 30 * DAY, NOW)).toBe('cooling'); // boundary inclusive
    expect(engagementStatus(NOW - 40 * DAY, NOW)).toBe('dormant');
  });
});

describe('fmtDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(fmtDuration(0)).toBe('—');
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(300)).toBe('5m');
    expect(fmtDuration(3900)).toBe('1h 05m');
    expect(fmtDuration(7200)).toBe('2h 00m');
  });
});

describe('cohortRetention', () => {
  it('groups signups into Monday-start weekly cohorts and measures return weeks', () => {
    const users = [
      { id: 'u1', createdAt: '2026-07-06T09:00:00Z' }, // this week's cohort
      { id: 'u2', createdAt: '2026-06-23T09:00:00Z' }, // cohort of Mon 2026-06-22
      { id: 'u3', createdAt: '2026-06-24T18:00:00Z' }, // same cohort
    ];
    const active = new Map<string, string[]>([
      ['u1', ['2026-07-06']],
      ['u2', ['2026-06-23', '2026-06-30']], // W0 + W1
      ['u3', ['2026-06-24']],               // W0 only
    ]);
    const rows = cohortRetention(users, active, { now: NOW, weeks: 8 });

    expect(rows).toHaveLength(2);
    // Newest cohort first.
    expect(rows[0].weekStart).toBe('2026-07-06');
    expect(rows[0].size).toBe(1);
    expect(rows[0].cells[0]).toBe(100);
    expect(rows[0].cells[1]).toBeNull(); // future week

    expect(rows[1].weekStart).toBe('2026-06-22');
    expect(rows[1].size).toBe(2);
    expect(rows[1].cells[0]).toBe(100); // both seen in signup week
    expect(rows[1].cells[1]).toBe(50);  // only u2 came back
    expect(rows[1].cells[2]).toBe(0);   // week has started, nobody yet
    expect(rows[1].cells[3]).toBeNull();
  });

  it('drops cohorts older than the window and handles users with no activity', () => {
    const users = [
      { id: 'old', createdAt: '2026-04-01T00:00:00Z' },  // > 8 weeks before NOW
      { id: 'ghost', createdAt: '2026-06-23T00:00:00Z' },
    ];
    const rows = cohortRetention(users, new Map(), { now: NOW, weeks: 8 });
    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe('2026-06-22');
    expect(rows[0].cells[0]).toBe(0);
  });
});
