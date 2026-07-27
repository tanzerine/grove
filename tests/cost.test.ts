/**
 * Per-generation spend, so plan pricing can be argued from numbers.
 *
 * Nothing recorded LLM cost before this: lib/pipeline/capacity measured
 * wall-clock only, which sizes a tick but prices nothing. Every question about
 * margin — can Starter afford 12 posts at $29, is Growth priced right, are two
 * inline images per post worth it — could only be guessed at.
 *
 * The invariant these tests protect is narrow and important: an unknown cost
 * must never read as zero. A table that quietly prices unknown models at $0
 * produces totals that look precise and are wrong, which is worse than having
 * no totals at all.
 */
import { describe, it, expect } from 'vitest';
import {
  llmCostUsd, imageCostUsd, postCost, revenuePerPostUsd, marginPerPost, MODEL_PRICES,
} from '../lib/cost';
import { summarize, describeCost, type MeteredCall } from '../lib/cost-meter';

describe('llmCostUsd', () => {
  it('prices a call from its token counts', () => {
    const price = MODEL_PRICES['google/gemini-3.1-pro'];
    const cost = llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: 1e6, outputTokens: 1e6 });
    expect(cost).toBeCloseTo(price.inputPerMTok + price.outputPerMTok, 6);
  });

  it('charges output at its own higher rate', () => {
    const inOnly = llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: 1e6, outputTokens: 0 })!;
    const outOnly = llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: 0, outputTokens: 1e6 })!;
    expect(outOnly).toBeGreaterThan(inOnly);
  });

  it('returns null — never zero — for a model it cannot price', () => {
    expect(llmCostUsd({ model: 'some/unlisted-model', inputTokens: 5000, outputTokens: 5000 })).toBeNull();
  });

  it('returns null when the provider reported no tokens', () => {
    expect(llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: null, outputTokens: null })).toBeNull();
    expect(llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: 0, outputTokens: 0 })).toBeNull();
  });

  it('survives missing and malformed input', () => {
    expect(llmCostUsd(null)).toBeNull();
    expect(llmCostUsd(undefined)).toBeNull();
    expect(llmCostUsd({ model: '', inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(llmCostUsd({ model: 'google/gemini-3.1-pro', inputTokens: NaN, outputTokens: 5 })).toBeNull();
  });

  it('prices the strategy tier far above the workhorse', () => {
    // The whole reason strategy runs rarely. If these ever invert, the
    // rationale in lib/llm's comments is wrong and needs revisiting.
    const opus = MODEL_PRICES['anthropic/claude-opus-4.7'];
    const workhorse = MODEL_PRICES['google/gemini-3.1-pro'];
    expect(opus.outputPerMTok).toBeGreaterThan(workhorse.outputPerMTok);
  });
});

describe('imageCostUsd', () => {
  it('prices by quality tier', () => {
    const low = imageCostUsd('openai/gpt-image-2', 'low')!;
    const med = imageCostUsd('openai/gpt-image-2', 'medium')!;
    const high = imageCostUsd('openai/gpt-image-2', 'high')!;
    expect(low).toBeLessThan(med);
    expect(med).toBeLessThan(high);
  });

  it('returns null for an unknown model or quality', () => {
    expect(imageCostUsd('some/model')).toBeNull();
    expect(imageCostUsd('openai/gpt-image-2', 'ultra')).toBeNull();
  });
});

describe('summarize', () => {
  const call = (model: string, costUsd: number | null, inTok = 1000, outTok = 500): MeteredCall =>
    ({ model, inputTokens: inTok, outputTokens: outTok, predictTimeMs: 1000, costUsd });

  it('totals a run and splits it by model', () => {
    const s = summarize([
      call('google/gemini-3.1-pro', 0.01),
      call('google/gemini-3.1-pro', 0.02),
      call('anthropic/claude-opus-4.7', 0.5),
    ]);
    expect(s.calls).toBe(3);
    expect(s.totalUsd).toBeCloseTo(0.53, 6);
    expect(s.byModel['google/gemini-3.1-pro']).toBeCloseTo(0.03, 6);
    expect(s.byModel['anthropic/claude-opus-4.7']).toBeCloseTo(0.5, 6);
  });

  it('counts unpriced calls instead of treating them as free', () => {
    const s = summarize([call('google/gemini-3.1-pro', 0.01), call('mystery/model', null)]);
    expect(s.totalUsd).toBeCloseTo(0.01, 6);
    expect(s.unpriced).toBe(1);
    expect(s.calls).toBe(2);
    // The unpriced call must not appear in byModel as $0.
    expect(s.byModel['mystery/model']).toBeUndefined();
  });

  it('accumulates tokens even for calls it cannot price', () => {
    const s = summarize([call('mystery/model', null, 2000, 800)]);
    expect(s.inputTokens).toBe(2000);
    expect(s.outputTokens).toBe(800);
  });

  it('handles an empty run', () => {
    const s = summarize([]);
    expect(s).toEqual({ totalUsd: 0, calls: 0, unpriced: 0, inputTokens: 0, outputTokens: 0, byModel: {}, estimated: false });
  });

  it('renders a log line a human can read', () => {
    const line = describeCost(summarize([call('google/gemini-3.1-pro', 0.0182, 14200, 5100)]));
    expect(line).toContain('$0.0182');
    expect(line).toContain('1 call');
    expect(line).toContain('14.2k in / 5.1k out');
  });

  it('says so in the log line when something went unpriced', () => {
    const line = describeCost(summarize([call('mystery/model', null)]));
    expect(line).toContain('1 unpriced');
  });

  it('marks an estimated total so it cannot pass as measured', () => {
    // The first production run showed the workhorse reporting no token counts,
    // so tokens are estimated from length (~±25%). A bare "$0.0182" would
    // invite someone to price plans off a figure that precise. It must not.
    const estimated = { ...call('google/gemini-3.1-pro', 0.0182, 14200, 5100), estimated: true };
    const line = describeCost(summarize([estimated]));
    expect(line.startsWith('~$')).toBe(true);
    expect(line).toContain('est. tokens');
  });

  it('leaves a measured total unmarked', () => {
    const line = describeCost(summarize([call('google/gemini-3.1-pro', 0.0182, 14200, 5100)]));
    expect(line.startsWith('$')).toBe(true);
    expect(line).not.toContain('est. tokens');
  });

  it('flags the whole run as estimated if any single call was', () => {
    const s = summarize([
      call('google/gemini-3.1-pro', 0.01),
      { ...call('google/gemini-3.1-pro', 0.01), estimated: true },
    ]);
    expect(s.estimated).toBe(true);
  });
});

describe('postCost', () => {
  it('totals a generation_log and breaks it down by step', () => {
    const c = postCost([
      { step: 'writer', model: 'm', cost_usd: 0.01 },
      { step: 'writer', model: 'm', cost_usd: 0.008 },
      { step: 'manager', model: 'm', cost_usd: 0.004 },
      { step: 'persist' },
    ]);
    expect(c.totalUsd).toBeCloseTo(0.022, 6);
    expect(c.byStep.writer).toBeCloseTo(0.018, 6);
    expect(c.byStep.manager).toBeCloseTo(0.004, 6);
  });

  it('flags steps that spent something we could not price', () => {
    const c = postCost([
      { step: 'writer', model: 'm', cost_usd: 0.01 },
      { step: 'cover_image', model: 'unknown/img', cost_usd: null },
    ]);
    expect(c.unpriced).toBe(1);
    expect(c.totalUsd).toBeCloseTo(0.01, 6);
  });

  it('ignores steps that never spent anything', () => {
    expect(postCost([{ step: 'queued' }, { step: 'persist' }]).unpriced).toBe(0);
  });

  it('handles null and empty logs', () => {
    expect(postCost(null).totalUsd).toBe(0);
    expect(postCost([]).totalUsd).toBe(0);
  });
});

describe('unit economics', () => {
  it('computes revenue per post for each tier', () => {
    expect(revenuePerPostUsd(29, 12)).toBe(2.42);
    expect(revenuePerPostUsd(79, 40)).toBe(1.98);
    expect(revenuePerPostUsd(199, 150)).toBe(1.33);
  });

  it('shows revenue per post FALLING as the tier rises', () => {
    // Cost per post is roughly flat, so this is the shape that decides whether
    // Agency is the thinnest-margin plan. Worth failing loudly if pricing moves.
    const starter = revenuePerPostUsd(29, 12)!;
    const growth = revenuePerPostUsd(79, 40)!;
    const agency = revenuePerPostUsd(199, 150)!;
    expect(growth).toBeLessThan(starter);
    expect(agency).toBeLessThan(growth);
  });

  it('computes margin, and refuses to guess when either side is unknown', () => {
    expect(marginPerPost(2.42, 0.242)).toBeCloseTo(0.9, 3);
    expect(marginPerPost(null, 0.2)).toBeNull();
    expect(marginPerPost(2.42, null)).toBeNull();
    expect(marginPerPost(0, 0.2)).toBeNull();
  });

  it('reports a negative margin rather than clamping it', () => {
    expect(marginPerPost(1.33, 2.0)).toBeLessThan(0);
  });
});
