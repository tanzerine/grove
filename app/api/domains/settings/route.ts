import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { isPublicHttpUrl } from '@/lib/net/ssrf';
import { normalizeCanonicalBase } from '@/lib/seo';

const schema = z.object({
  domain_id: z.string().uuid(),
  auto_publish: z.boolean().optional(),
  auto_social: z.boolean().optional(),
  posts_per_week: z.number().min(1).max(14).optional(),
  // empty string clears the webhook; a URL sets it (https only).
  social_webhook_url: z.string().url().startsWith('https://').or(z.literal('')).optional(),
  // customer-hosted article base for canonical URLs; empty string clears it.
  canonical_blog_base: z.string().max(300).optional(),
});

export async function PATCH(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { domain_id, ...updates } = parsed.data;
  const patch: Record<string, unknown> = { ...updates };

  // Canonical base: normalize (force https shape, strip trailing slash) and
  // store null when cleared or unparseable — a garbage base must never leak
  // into canonical/sitemap/RSS URLs.
  if (updates.canonical_blog_base !== undefined) {
    const normalized = normalizeCanonicalBase(updates.canonical_blog_base);
    if (updates.canonical_blog_base.trim() !== '' && !normalized) {
      return NextResponse.json({ error: 'canonical base must be a valid URL like https://example.com/blog' }, { status: 400 });
    }
    patch.canonical_blog_base = normalized;
  }

  // Webhook lifecycle: clearing the URL drops the secret too; setting a URL
  // mints a signing secret if the domain doesn't already have one.
  if (updates.social_webhook_url !== undefined) {
    if (updates.social_webhook_url === '') {
      patch.social_webhook_url = null;
      patch.social_webhook_secret = null;
    } else {
      // The cron POSTs to this URL server-side, so block targets that resolve
      // to internal/private addresses (SSRF). https is already enforced by zod.
      if (!(await isPublicHttpUrl(updates.social_webhook_url))) {
        return NextResponse.json({ error: 'webhook URL must be a public https endpoint' }, { status: 400 });
      }
      const { data: existing } = await sb
        .from('domains').select('social_webhook_secret')
        .eq('id', domain_id).eq('user_id', user.id).maybeSingle();
      if (!existing?.social_webhook_secret) {
        patch.social_webhook_secret = 'whsec_' + randomBytes(24).toString('hex');
      }
    }
  }

  const { error } = await sb.from('domains').update(patch).eq('id', domain_id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
