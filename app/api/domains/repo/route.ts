import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseRepoRef, syncRepoKnowledge } from '@/lib/pipeline/repo-knowledge';
import { encryptToken, decryptToken } from '@/lib/social/crypto';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const maxDuration = 120;

const body = z.object({
  id: z.string().uuid(),
  repo: z.string().min(3).max(200).optional(),   // omitted = re-sync the stored repo
  token: z.string().max(400).optional(),          // fine-grained PAT for private repos
});

/**
 * Connect a GitHub repo to a domain (or re-sync an already-connected one):
 * reads the repo's docs, extracts product knowledge, stores it on the domain.
 * The knowledge feeds tutorial / deep-dive article formats in the pipeline.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`repo:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // RLS scopes this select to the caller's own domains.
  const { data: domain } = await sb.from('domains').select('*').eq('id', parsed.data.id).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const ref = parseRepoRef(parsed.data.repo ?? domain.github_repo ?? '');
  if (!ref) {
    return NextResponse.json(
      { ok: false, error: 'Enter the repository as "owner/repo" or a github.com URL.' },
      { status: 400 },
    );
  }

  // Token precedence: freshly-entered > stored (so a re-sync keeps working
  // for private repos without re-pasting the token every time).
  const token = parsed.data.token?.trim()
    || (domain.github_repo_token ? decryptToken(domain.github_repo_token) : undefined)
    || undefined;

  try {
    const knowledge = await syncRepoKnowledge(ref, token);
    const admin = supabaseAdmin();
    await admin.from('domains').update({
      github_repo: ref,
      ...(parsed.data.token?.trim() ? { github_repo_token: encryptToken(parsed.data.token.trim()) } : {}),
      repo_knowledge: knowledge,
    }).eq('id', domain.id);
    return NextResponse.json({ ok: true, knowledge });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/** Disconnect the repo: clears the connection, token, and extracted knowledge. */
export async function DELETE(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const { data: domain } = await sb.from('domains').select('id').eq('id', id).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const admin = supabaseAdmin();
  await admin.from('domains').update({
    github_repo: null,
    github_repo_token: null,
    repo_knowledge: null,
  }).eq('id', domain.id);
  return NextResponse.json({ ok: true });
}
