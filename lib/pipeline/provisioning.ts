/**
 * After domain verification:
 *   1. Deep-crawl the site and store a rich SiteProfile JSON
 *   2. Enqueue a first "intro" post topic
 *
 * Fire-and-forget on Vercel — must not block the verify response.
 */
import { supabaseAdmin } from '../supabase/admin';
import { profileSite } from './site-profile';

export async function kickoffProvisioning(domainId: string) {
  setTimeout(() => provisionInner(domainId).catch(console.error), 0);
}

async function provisionInner(domainId: string) {
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('*').eq('id', domainId).single();
  if (!domain) return;

  const profile = await profileSite(domain.hostname).catch((e) => {
    console.error('profileSite failed', e);
    return null;
  });
  if (profile) await sb.from('domains').update({ site_profile: profile }).eq('id', domainId);

  // queue an intro topic that uses the profile we just built
  const topic = profile?.business?.description
    ? `Introducing ${profile.business.name}: how we help ${profile.business.target_audience}`
    : `Introductory post for ${domain.hostname}`;

  await sb.from('posts').insert({ domain_id: domainId, status: 'queued', topic });
}
