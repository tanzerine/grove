/**
 * Persistence for the agent's markdown working memory (agent_context table).
 * Composition is pure (context.ts); this file only reads/writes rows via the
 * service role — RLS gives owners read-only access.
 */
import { supabaseAdmin } from '../supabase/admin';
import { composePlanMd, appendProgress } from './context';
import type { Strategy } from './build';

export type AgentContext = { plan_md: string; progress_md: string };

export async function getAgentContext(domainId: string): Promise<AgentContext> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('agent_context')
    .select('plan_md, progress_md')
    .eq('domain_id', domainId)
    .maybeSingle();
  return { plan_md: data?.plan_md ?? '', progress_md: data?.progress_md ?? '' };
}

/** Rebuild plan_md from a strategy — call after every build or revision.
 *  Upsert touches only plan_md, so the progress log is preserved. */
export async function savePlanContext(
  domainId: string,
  strategy: Strategy,
  hostname: string,
): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from('agent_context').upsert(
    {
      domain_id: domainId,
      plan_md: composePlanMd(strategy, { hostname }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'domain_id' },
  );
}

/** Append one weekly entry to the rolling progress log (trimmed to cap). */
export async function appendWeeklyProgress(domainId: string, entry: string): Promise<void> {
  const sb = supabaseAdmin();
  const current = await getAgentContext(domainId);
  await sb.from('agent_context').upsert(
    {
      domain_id: domainId,
      progress_md: appendProgress(current.progress_md, entry),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'domain_id' },
  );
}
