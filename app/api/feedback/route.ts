import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { captureServer } from '@/lib/analytics/capture-server';
import { sendEmail } from '@/lib/email/resend';
import { composeFeedbackOwnerEmail } from '@/lib/email/feedback';
import { ownerNotifyEmail } from '@/lib/admin';
import { betaStateFrom } from '@/lib/beta';
import {
  FEEDBACK_AREA_CODES,
  FEEDBACK_KIND_IDS,
  FEEDBACK_SEVERITY_CODES,
  FEEDBACK_LIMITS,
  FEEDBACK_MIN_BODY,
  type FeedbackKind,
} from '@/lib/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  kind: z.string().refine((k) => (FEEDBACK_KIND_IDS as string[]).includes(k), 'invalid kind'),
  body: z.string().min(FEEDBACK_MIN_BODY).max(FEEDBACK_LIMITS.body),
  headline: z.string().max(FEEDBACK_LIMITS.headline).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  area: z.string().refine((a) => FEEDBACK_AREA_CODES.includes(a), 'invalid area').optional(),
  severity: z.string().refine((s) => (FEEDBACK_SEVERITY_CODES as string[]).includes(s), 'invalid severity').optional(),
  consent_publish: z.boolean().optional(),
  display_name: z.string().max(FEEDBACK_LIMITS.displayName).optional(),
  display_role: z.string().max(FEEDBACK_LIMITS.displayRole).optional(),
  display_url: z.string().max(FEEDBACK_LIMITS.displayUrl).optional(),
});

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

/**
 * Customer→owner feedback: testimonial, shortcoming, or complaint.
 *
 * Records the message and emails the owner. Nothing here is automated beyond
 * that on purpose — a complaint is answered by a person, and a testimonial
 * reaches the marketing site only when the owner publishes it (see the admin
 * PATCH). The customer consents to being quotable; they don't publish
 * themselves, and we don't publish for them.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`feedback:${user.id}`, LIMITS.feedback);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const input = parsed.data;
  const kind = input.kind as FeedbackKind;

  // Fields only mean something on their own kind. Dropping the rest server-side
  // (rather than trusting the form to have hidden them) is what stops a
  // hand-rolled POST attaching publication consent to a complaint and turning
  // an angry message into a quotable one.
  const isTestimonial = kind === 'testimonial';
  const isComplaint = kind === 'complaint';

  const admin = supabaseAdmin();

  // ── context, gathered server-side ────────────────────────────────────────
  // Never taken from the request: the whole value of these fields is that the
  // customer can't be wrong about them and doesn't have to be asked.
  const [{ data: subRow }, postsPublished] = await Promise.all([
    admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle(),
    countPublishedPosts(admin, user.id),
  ]);
  const beta = betaStateFrom(subRow);

  const { data: inserted, error: insErr } = await admin
    .from('feedback')
    .insert({
      user_id: user.id,
      email: user.email ?? null,
      kind,
      body: input.body.trim(),
      headline: input.headline?.trim() || null,
      rating: input.rating ?? null,
      area: input.area ?? null,
      severity: isComplaint ? input.severity ?? null : null,
      consent_publish: isTestimonial ? !!input.consent_publish : false,
      display_name: isTestimonial ? input.display_name?.trim() || null : null,
      display_role: isTestimonial ? input.display_role?.trim() || null : null,
      display_url: isTestimonial ? input.display_url?.trim() || null : null,
      plan: (subRow as { plan?: string | null } | null)?.plan ?? null,
      beta_code: beta.present ? beta.code : null,
      posts_published: postsPublished,
      page_url: (req.headers.get('referer') ?? '').slice(0, 500) || null,
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('[feedback] insert error:', insErr.message);
    return NextResponse.json({ error: 'could not record feedback' }, { status: 500 });
  }

  // Notify the owner (best-effort — a mail hiccup must not lose the message,
  // which is already safely in Postgres and visible in the admin inbox).
  try {
    const { subject, html, text } = composeFeedbackOwnerEmail({
      kind,
      email: user.email ?? null,
      plan: (subRow as { plan?: string | null } | null)?.plan ?? null,
      betaCode: beta.present ? beta.code : null,
      rating: input.rating ?? null,
      headline: input.headline?.trim() || null,
      body: input.body.trim(),
      area: input.area ?? null,
      severity: isComplaint ? input.severity ?? null : null,
      postsPublished,
      consentPublish: isTestimonial ? !!input.consent_publish : false,
      displayName: isTestimonial ? input.display_name?.trim() || null : null,
      displayRole: isTestimonial ? input.display_role?.trim() || null : null,
      adminUrl: `${appOrigin(req)}/dashboard/admin/feedback`,
    });
    await sendEmail({ to: ownerNotifyEmail(), subject, html, text });
  } catch (e) {
    console.error('[feedback] notify error:', (e as Error).message);
  }

  await captureServer(user.id, 'feedback_submitted', {
    kind,
    area: input.area,
    severity: isComplaint ? input.severity : undefined,
    rating: input.rating,
    consent_publish: isTestimonial ? !!input.consent_publish : undefined,
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}

type Admin = ReturnType<typeof supabaseAdmin>;

/**
 * How many posts this customer has actually published.
 *
 * The single most useful number next to a piece of feedback: "the drafts aren't
 * good enough" from someone with 40 published posts is a quality problem, and
 * the same sentence from someone with none is an onboarding problem. Two
 * queries because posts hang off domains, not users. Best-effort — feedback
 * must never fail to record because a count didn't come back.
 */
async function countPublishedPosts(admin: Admin, userId: string): Promise<number | null> {
  try {
    const { data: domains } = await admin.from('domains').select('id').eq('user_id', userId);
    const ids = (domains ?? []).map((d: { id: string }) => d.id);
    if (!ids.length) return 0;
    const { count } = await admin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .in('domain_id', ids)
      .eq('status', 'published');
    return count ?? 0;
  } catch {
    return null;
  }
}
