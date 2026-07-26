import { describe, it, expect } from 'vitest';
import { clusterSeedFromTitle } from '../lib/cluster-seed';

describe('clusterSeedFromTitle', () => {
  it('strips listicle scaffolding down to the noun phrase', () => {
    expect(clusterSeedFromTitle('Finding the Best Auto Background Remover App: 7 Top Picks for 2026'))
      .toBe('auto background remover app');
  });

  it('drops a how-to opener', () => {
    expect(clusterSeedFromTitle('How to Remove Backgrounds From Product Photos'))
      .toBe('remove backgrounds from product photos');
  });

  it('keeps the head when the subtitle is the scaffolding half', () => {
    expect(clusterSeedFromTitle('Cold Brew Ratios — A Complete Guide')).toBe('cold brew ratios');
  });

  it('uses the tail when the head is a single word', () => {
    expect(clusterSeedFromTitle('Guide: Espresso Grind Size for Beginners'))
      .toBe('espresso grind size for beginners');
  });

  it('drops years and leading counts', () => {
    expect(clusterSeedFromTitle('10 Email Deliverability Mistakes in 2026'))
      .toBe('email deliverability mistakes');
  });

  it('ignores parentheticals', () => {
    expect(clusterSeedFromTitle('Invoice Automation (And Why It Pays Off)'))
      .toBe('invoice automation');
  });

  it('caps to a searchable number of words', () => {
    expect(clusterSeedFromTitle('Warehouse Robotics Deployment Planning For Mid Market Logistics Teams In Europe'))
      .toBe('warehouse robotics deployment planning for mid');
  });

  it('falls back to the title when it is all scaffolding', () => {
    expect(clusterSeedFromTitle('The Ultimate Guide')).toBe('the ultimate guide');
  });

  it('leaves non-latin titles intact', () => {
    expect(clusterSeedFromTitle('배경 제거 앱 고르는 법')).toBe('배경 제거 앱 고르는 법');
  });

  it('returns empty for unusable input', () => {
    expect(clusterSeedFromTitle('   ')).toBe('');
    expect(clusterSeedFromTitle('2026')).toBe('');
  });
});
