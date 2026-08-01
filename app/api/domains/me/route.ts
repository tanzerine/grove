import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomainFields } from '@/lib/active-domain';

export const dynamic = 'force-dynamic';

/**
 * The domain the user is CURRENTLY MANAGING — i.e. whatever the site switcher
 * is pointing at.
 *
 * This used to be "the primary verified domain":
 *
 *     .order('verified_at', { ascending: false, nullsFirst: false })
 *     .order('created_at', { ascending: false })
 *     .limit(1)
 *
 * which ignored `grove_active_domain` entirely, so it returned the same row no
 * matter which site was selected. On a multi-site account that made
 * /onboarding/intent — the "Edit intent" screen — permanently show and SAVE the
 * most-recently-verified domain. The owner of two sites saw identical answers
 * under both, and pressing "Save and continue" POSTed to the wrong domain's
 * interview, which rebuilds THAT domain's plan (replaceActive). So the site
 * they were trying to fix stayed untouched while the other one was quietly
 * re-planned, and nothing in the UI said so.
 *
 * The switcher's cookie is the single source of truth for "which site am I
 * managing"; every surface has to read it or they disagree about what the user
 * is looking at.
 */
export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Narrow column list on purpose — this response goes to the browser, and the
  // full row carries gsc_refresh_token / github_repo_token / webhook secrets.
  const domain = await getActiveDomainFields(
    sb,
    'id, hostname, verified_at, interview, site_profile',
  );

  return NextResponse.json({ domain });
}
