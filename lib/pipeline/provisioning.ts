/**
 * After domain verification: profile voice + enqueue first topic.
 * Designed to be fire-and-forget on Vercel's serverless runtime.
 */
import { supabaseAdmin } from '../supabase/admin';
import { profileVoice } from './voice';

export async function kickoffProvisioning(domainId: string) {
  // not awaited on purpose — voice profiling can take 5-15s; we kick off and return
  setTimeout(() => provisionInner(domainId).catch(console.error), 0);
}

async function provisionInner(domainId: string) {
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('*').eq('id', domainId).single();
  if (!domain) return;

  const voice = await profileVoice(domain.hostname).catch(() => null);
  if (voice) await sb.from('domains').update({ brand_voice: voice }).eq('id', domainId);

  // queue a first-post topic based on the domain — the cron worker will pick it up immediately
  await sb.from('posts').insert({
    domain_id: domainId,
    status: 'queued',
    topic: `introductory post for ${domain.hostname} — overview of what we do and who we help`,
  });
}
