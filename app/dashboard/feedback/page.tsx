import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { betaStateFrom } from '@/lib/beta';
import { isFeedbackKind, kindLabel, statusLabel, type FeedbackKind } from '@/lib/feedback';
import FeedbackForm from './FeedbackForm';
import { DashHeader } from '../gv-chrome';

export const dynamic = 'force-dynamic';

const LINE = 'rgba(255,255,255,0.08)';

/**
 * The customer's direct line to Grove's owner.
 *
 * `?kind=` deep-links a specific door, so "tell us why" from the lapsed-beta
 * panel and "report a problem" from anywhere else land on the right tab
 * pre-selected rather than on a chooser.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const initialKind: FeedbackKind = isFeedbackKind(sp.kind) ? sp.kind : 'testimonial';

  // Both reads tolerate the pre-migration state: this page must still render
  // (and still let someone complain) before 0033/0034 are applied.
  let sub: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    sub = data;
  } catch { /* pre-migration — no beta context */ }

  let mine: { id: string; kind: string; status: string; created_at: string; responded_at: string | null }[] = [];
  try {
    const { data } = await sb
      .from('feedback')
      .select('id, kind, status, created_at, responded_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    mine = data ?? [];
  } catch { /* table not migrated yet — the form still works once it is */ }

  const beta = betaStateFrom(sub);
  // Best-effort display name from the auth profile, so someone consenting to be
  // quoted isn't made to retype what we already know.
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const defaultName = (meta.full_name || meta.name || '').trim();

  return (
    <>
      <DashHeader
        title="Tell us the truth"
        subtitle="Praise, shortcomings, or a complaint — it all reaches the owner"
      />
      <div className="gv-body">
        <FeedbackForm initialKind={initialKind} defaultName={defaultName} isBeta={beta.active} />

        {mine.length > 0 && (
          <div style={{ maxWidth: 640, margin: '18px auto 0' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>
              What you&apos;ve sent
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {mine.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ fontSize: 13, color: 'var(--gv-soft)', flex: 1 }}>{kindLabel(m.kind)}</span>
                  <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>
                    {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {/* "Seen by the owner" is the only state the customer is told
                      about. The internal triage vocabulary — wont_fix and the
                      rest — is for the owner's inbox, not for the person who
                      took the trouble to write in. */}
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: m.responded_at ? 'var(--gv-accent-ink)' : 'var(--gv-faint)' }}>
                    {m.responded_at ? 'Seen by the owner' : statusLabel('new')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
