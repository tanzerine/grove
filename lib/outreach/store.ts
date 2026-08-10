/**
 * SERVER-ONLY reads and writes over `outreach_prospects` (migration 0035).
 *
 * Split from screen.ts/dm.ts for the same reason beta-store is split from beta:
 * those two are imported by the admin client component, and must never pull in
 * the service-role client.
 *
 * Every read is best-effort and returns empty rather than throwing, so the admin
 * page still renders before 0035 is applied — the same defence beta-store uses.
 * Writes are the exception: a save that silently did nothing would let the same
 * person be DMed twice, which is the one outcome this table exists to prevent.
 */
import { supabaseAdmin } from '../supabase/admin';
import type { Prospect, Tier } from './screen';
import type { DmDraft } from './dm';

export type ProspectStatus = 'new' | 'skipped' | 'contacted' | 'replied' | 'joined';

export type ProspectRow = {
  id: string;
  source: string;
  author: string;
  subreddit: string | null;
  post_id: string | null;
  post_url: string | null;
  post_title: string | null;
  posted_at: string | null;
  fit: number;
  tier: Tier;
  pain: string | null;
  evidence: { key: string; label: string; quote: string }[];
  blockers: { kind: string; label: string; hard: boolean; quote: string | null }[];
  dm_subject: string | null;
  dm_body: string | null;
  personalized: boolean;
  status: ProspectStatus;
  coupon_code: string | null;
  contacted_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Every username already in the table, whatever their status.
 *
 * Passed straight into `rankProspects({ excludeAuthors })`. Includes `skipped`
 * on purpose: a prospect the owner already read and rejected should not come
 * back up the list next week to be read and rejected again.
 */
export async function knownAuthors(source = 'reddit'): Promise<Set<string>> {
  try {
    const { data } = await supabaseAdmin()
      .from('outreach_prospects')
      .select('author')
      .eq('source', source)
      .limit(5000);
    return new Set((data ?? []).map((r: { author: string }) => r.author.toLowerCase()));
  } catch {
    return new Set();
  }
}

export type SaveResult = { saved: ProspectRow[]; duplicates: number };

/**
 * Persist a scan's results.
 *
 * The batch insert is attempted first and falls back to row-by-row on a unique
 * violation. That fallback is not paranoia: `knownAuthors` is read at the start
 * of a scan, so two scans running near each other can both decide the same
 * username is new, and a batch insert is all-or-nothing — one collision would
 * throw away every genuinely new prospect in the run.
 */
export async function saveProspects(
  found: { prospect: Prospect; draft: DmDraft; personalized: boolean; couponCode: string | null }[],
  source = 'reddit',
): Promise<SaveResult> {
  if (!found.length) return { saved: [], duplicates: 0 };
  const admin = supabaseAdmin();
  const rows = found.map((f) => toRow(f, source));

  const { data, error } = await admin.from('outreach_prospects').insert(rows).select('*');
  if (!error) return { saved: (data ?? []) as ProspectRow[], duplicates: 0 };
  if (error.code !== '23505') throw new Error(`could not save prospects: ${error.message}`);

  const saved: ProspectRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const one = await admin.from('outreach_prospects').insert(row).select('*').single();
    if (one.error) {
      if (one.error.code === '23505') duplicates++;
      else throw new Error(`could not save prospect ${row.author}: ${one.error.message}`);
      continue;
    }
    saved.push(one.data as ProspectRow);
  }
  return { saved, duplicates };
}

function toRow(
  f: { prospect: Prospect; draft: DmDraft; personalized: boolean; couponCode: string | null },
  source: string,
) {
  const { post, screen } = f.prospect;
  return {
    source,
    author: post.author,
    subreddit: post.subreddit || null,
    post_id: post.id,
    post_url: post.permalink,
    post_title: post.title,
    posted_at: post.createdUtc ? new Date(post.createdUtc * 1000).toISOString() : null,
    fit: screen.fit,
    tier: screen.tier,
    pain: screen.pain,
    evidence: screen.evidence,
    blockers: screen.blockers,
    dm_subject: f.draft.subject,
    dm_body: f.draft.body,
    personalized: f.personalized,
    coupon_code: f.couponCode,
  };
}

export async function listProspects(
  opts: { status?: ProspectStatus | 'open'; limit?: number } = {},
): Promise<ProspectRow[]> {
  try {
    let q = supabaseAdmin()
      .from('outreach_prospects')
      .select('*')
      .order('fit', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 100);
    // "open" is the triage view: everything still awaiting a decision.
    if (opts.status === 'open') q = q.eq('status', 'new');
    else if (opts.status) q = q.eq('status', opts.status);
    const { data } = await q;
    return (data ?? []) as ProspectRow[];
  } catch {
    return [];
  }
}

export type ProspectPatch = {
  status?: ProspectStatus;
  note?: string | null;
  dm_body?: string;
  dm_subject?: string;
};

/**
 * Update one prospect.
 *
 * Stamps `contacted_at` on the transition to `contacted` so the funnel has a
 * date the owner didn't have to type. Later statuses (`replied`, `joined`)
 * leave the original stamp alone — it records when we wrote, not when it worked.
 */
export async function updateProspect(id: string, patch: ProspectPatch): Promise<ProspectRow | null> {
  const fields: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status === 'contacted') fields.contacted_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from('outreach_prospects')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return (data as ProspectRow) ?? null;
}

export type OutreachStats = {
  open: number;
  contacted: number;
  replied: number;
  joined: number;
  /** contacted → replied, as a percentage. 0 when nothing has been sent. */
  replyRate: number;
};

export const EMPTY_OUTREACH_STATS: OutreachStats = {
  open: 0, contacted: 0, replied: 0, joined: 0, replyRate: 0,
};

export async function outreachStats(): Promise<OutreachStats> {
  try {
    const { data } = await supabaseAdmin().from('outreach_prospects').select('status').limit(5000);
    const out = { ...EMPTY_OUTREACH_STATS };
    for (const r of (data ?? []) as { status: ProspectStatus }[]) {
      if (r.status === 'new') out.open++;
      // Reply and join both imply the DM went out, so they count as contacted
      // too — otherwise the reply rate divides by the ones that didn't work.
      if (r.status === 'contacted' || r.status === 'replied' || r.status === 'joined') out.contacted++;
      if (r.status === 'replied' || r.status === 'joined') out.replied++;
      if (r.status === 'joined') out.joined++;
    }
    out.replyRate = out.contacted ? Math.round((out.replied / out.contacted) * 100) : 0;
    return out;
  } catch {
    return EMPTY_OUTREACH_STATS;
  }
}
