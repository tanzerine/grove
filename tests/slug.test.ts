import { describe, it, expect } from 'vitest';
import { postSlug } from '../lib/slug';

const ID = '4f9b2c1a-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

describe('postSlug', () => {
  it('slugifies an ASCII title', () => {
    expect(postSlug('How to Brew Filter Coffee', ID)).toBe('how-to-brew-filter-coffee');
  });

  it('folds accented Latin instead of dropping it', () => {
    expect(postSlug('Café Décor Guide', ID)).toBe('cafe-decor-guide');
  });

  // The stress run: CJK/emoji-only titles slugified to '' — the article then
  // published at the blog-home URL. Must fall back to a stable id-derived slug.
  it('falls back to post-{id8} for a Korean-only title', () => {
    expect(postSlug('커피 원두 보관법 총정리', ID)).toBe('post-4f9b2c1a');
  });

  it('falls back for emoji-only and empty titles', () => {
    expect(postSlug('🚀🚀🚀', ID)).toBe('post-4f9b2c1a');
    expect(postSlug('', ID)).toBe('post-4f9b2c1a');
    expect(postSlug(null, ID)).toBe('post-4f9b2c1a');
  });

  it('survives a missing fallback id', () => {
    expect(postSlug('🚀', undefined)).toBe('post');
  });

  it('caps at 80 chars without a trailing hyphen', () => {
    const long = 'word '.repeat(40);
    const slug = postSlug(long, ID);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('-')).toBe(false);
  });

  it('keeps mixed KO/EN titles on their ASCII part', () => {
    expect(postSlug('커피 브루잉 Guide 2026', ID)).toBe('guide-2026');
  });
});
