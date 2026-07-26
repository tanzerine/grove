/**
 * Append-only per-post pipeline log.
 *
 * Read-modify-write is safe here because all log writes inside generate.ts
 * happen sequentially in one function call. We never have two callers
 * appending to the same post concurrently.
 */
import { supabaseAdmin } from '../supabase/admin';
import { llmCostUsd, type LlmUsage } from '../cost';

export type LogEvent = 'start' | 'done' | 'fail';
export type LogStep =
  | 'queued' | 'site_profile' | 'research' | 'topic_refiner'
  | 'writer' | 'manager' | 'persist' | 'cover_image' | 'inline_images' | 'social';

export type LogEntry = {
  ts: number;          // ms epoch
  step: LogStep;
  event: LogEvent;
  message?: string;
  /* ── spend, when this step bought something ────────────────────────────
     The log already exists per post and is already read back for timing
     (lib/pipeline/capacity), so it is the natural place to record cost too —
     no new table, no second write path to keep in sync. Absent on steps that
     spend nothing. */
  model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  /** Null means "we couldn't price it", never "it was free". See lib/cost. */
  cost_usd?: number | null;
};

/** Optional spend to attach to a log entry. */
export type LogSpend =
  | { usage: LlmUsage }
  | { model: string; costUsd: number | null };

function spendFields(spend?: LogSpend): Partial<LogEntry> {
  if (!spend) return {};
  if ('usage' in spend) {
    const { model, inputTokens, outputTokens } = spend.usage;
    return {
      model,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      cost_usd: llmCostUsd(spend.usage),
    };
  }
  return { model: spend.model, cost_usd: spend.costUsd };
}

export async function appendLog(
  postId: string,
  step: LogStep,
  event: LogEvent,
  message?: string,
  spend?: LogSpend,
) {
  const sb = supabaseAdmin();
  const { data } = await sb.from('posts').select('generation_log').eq('id', postId).single();
  const log: LogEntry[] = (data?.generation_log as LogEntry[]) ?? [];
  log.push({
    ts: Date.now(), step, event,
    ...(message ? { message } : {}),
    ...spendFields(spend),
  });
  await sb.from('posts').update({ generation_log: log }).eq('id', postId);
  // also mirror to stdout for Vercel logs
  const tag = `[generate ${postId}] ${step}:${event}${message ? ' — ' + message : ''}`;
  if (event === 'fail') console.error(tag);
  else console.log(tag);
}

/**
 * Start a fresh log for a run. Seeds one entry rather than emptying the array:
 * the scheduler tells a live generation from one the platform killed by how
 * stale the log's newest timestamp is (lib/pipeline/capacity isStranded), and an
 * empty log carries no timestamp to judge. Seeding closes the window where a
 * just-started post looks abandoned — or an abandoned one looks untouched.
 */
export async function resetLog(postId: string) {
  const sb = supabaseAdmin();
  await sb.from('posts').update({ generation_log: seedLog() }).eq('id', postId);
}

/** The single 'queued' entry a run (or a claim) starts its log with. */
export function seedLog(): LogEntry[] {
  return [{ ts: Date.now(), step: 'queued', event: 'start' }];
}
