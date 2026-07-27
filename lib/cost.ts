/**
 * What a generation actually costs.
 *
 * Nothing in this codebase recorded LLM spend. `lib/pipeline/capacity` measures
 * wall-clock seconds — enough to size a tick, useless for pricing — so every
 * question about plan margin ("can Starter afford 12 posts at $29?", "is Growth
 * priced right?", "are 2 inline images per post worth it?") could only be
 * answered by guessing.
 *
 * Revenue per post is known and differs sharply by tier:
 *
 *     Starter  $29 / 12  = $2.42
 *     Growth   $79 / 40  = $1.98
 *     Agency  $199 / 150 = $1.33
 *
 * Cost per post is roughly flat across tiers, which means Agency carries the
 * thinnest unit margin while also being sold "priority pipeline". Whether that
 * is fine or alarming depends on the actual number — hence this file.
 *
 * PRICES ARE ESTIMATES AND WILL DRIFT. They are list prices per provider, not
 * invoices, so treat totals as an indicator to act on, not accounting. When a
 * model is missing from the table the cost is reported as null rather than
 * zero: an unknown cost must never silently read as "free", which is exactly
 * how this kind of table rots into confidently wrong numbers.
 */

/** USD per 1M tokens, per Replicate's published pricing. */
export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'google/gemini-3.1-pro': { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  'anthropic/claude-opus-4.7': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'meta/llama-3.2-3b-instruct': { inputPerMTok: 0.015, outputPerMTok: 0.025 },
};

/** USD per generated image, by model and quality tier. */
export const IMAGE_PRICES: Record<string, Record<string, number>> = {
  'openai/gpt-image-2': { low: 0.011, medium: 0.042, high: 0.167 },
};

export type LlmUsage = {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Token counts were derived from length rather than reported by the provider. */
  estimated?: boolean;
};

/**
 * Cost of one LLM call in USD, or null when the model isn't priced here or the
 * provider reported no token counts.
 */
export function llmCostUsd(usage: LlmUsage | null | undefined): number | null {
  if (!usage?.model) return null;
  const price = MODEL_PRICES[usage.model];
  if (!price) return null;
  const inTok = Number(usage.inputTokens ?? 0);
  const outTok = Number(usage.outputTokens ?? 0);
  if (!Number.isFinite(inTok) || !Number.isFinite(outTok)) return null;
  if (inTok <= 0 && outTok <= 0) return null;
  return (inTok / 1e6) * price.inputPerMTok + (outTok / 1e6) * price.outputPerMTok;
}

/** Cost of one generated image in USD, or null when unpriced. */
export function imageCostUsd(model: string, quality = 'medium'): number | null {
  return IMAGE_PRICES[model]?.[quality] ?? null;
}

/** A generation_log entry carrying spend, as written by lib/pipeline/log. */
export type CostedLogEntry = {
  step?: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
};

export type PostCost = {
  /** Total USD across every priced step. */
  totalUsd: number;
  /** Per-step breakdown, so the expensive step is obvious. */
  byStep: Record<string, number>;
  /** Steps that reported spend we couldn't price — the honesty check. */
  unpriced: number;
};

/**
 * Total what one post cost, from its generation_log.
 *
 * Steps we can't price are counted separately rather than folded in as zero,
 * so a total is never quietly an undercount.
 */
export function postCost(log: readonly CostedLogEntry[] | null | undefined): PostCost {
  const out: PostCost = { totalUsd: 0, byStep: {}, unpriced: 0 };
  for (const e of log ?? []) {
    const step = e?.step ?? 'unknown';
    const cost = e?.cost_usd;
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      out.totalUsd += cost;
      out.byStep[step] = (out.byStep[step] ?? 0) + cost;
    } else if (e?.model || e?.input_tokens || e?.output_tokens) {
      out.unpriced++;
    }
  }
  // Round to a sane precision — sub-microdollar noise helps nobody.
  out.totalUsd = Math.round(out.totalUsd * 1e6) / 1e6;
  for (const k of Object.keys(out.byStep)) {
    out.byStep[k] = Math.round(out.byStep[k] * 1e6) / 1e6;
  }
  return out;
}

/** Monthly revenue per post for a tier — the number cost has to beat. */
export function revenuePerPostUsd(priceUsd: number, postsQuota: number): number | null {
  if (!Number.isFinite(priceUsd) || !Number.isFinite(postsQuota) || postsQuota <= 0) return null;
  return Math.round((priceUsd / postsQuota) * 100) / 100;
}

/** Gross margin per post, as a fraction. Null when either side is unknown. */
export function marginPerPost(revenueUsd: number | null, costUsd: number | null): number | null {
  if (revenueUsd == null || costUsd == null || revenueUsd <= 0) return null;
  return Math.round(((revenueUsd - costUsd) / revenueUsd) * 1000) / 1000;
}
