/**
 * A cover that doesn't happen must say why.
 *
 * `fetchCoverImage` used to return a bare `null`, so every distinct
 * failure — no API token, the image model refusing the prompt, a broken
 * storage bucket — reached `generation_log` as the same useless line,
 * "no image generated". Diagnosing a missing cover meant reproducing it by
 * hand. These tests pin the reason to the result.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fetchCoverImage, MAX_COVER_ATTEMPTS } from '../lib/pipeline/cover-image';

const ORIGINAL_TOKEN = process.env.REPLICATE_API_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = ORIGINAL_TOKEN;
});

describe('fetchCoverImage failure reporting', () => {
  it('names the missing credential rather than returning a bare null', async () => {
    delete process.env.REPLICATE_API_TOKEN;

    const result = await fetchCoverImage({ title: 'Why your MVP needs a blog' });

    expect(result.cover).toBeNull();
    expect(result.failure?.stage).toBe('config');
    expect(result.failure?.reason).toMatch(/REPLICATE_API_TOKEN/);
  });

  it('carries a reason on every failure, so nothing logs an empty explanation', async () => {
    delete process.env.REPLICATE_API_TOKEN;

    const { failure } = await fetchCoverImage({ title: 'anything' });

    // The caller interpolates these straight into generation_log; a blank
    // reason would put us right back where we started.
    expect(failure).toBeDefined();
    expect(failure!.reason.trim().length).toBeGreaterThan(0);
    expect(['config', 'model', 'storage']).toContain(failure!.stage);
  });

  it('keeps a bounded retry budget so a doomed cover is not re-billed forever', () => {
    expect(MAX_COVER_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_COVER_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
