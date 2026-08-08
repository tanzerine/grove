import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { listCoupons, betaStats } from '@/lib/beta-store';
import { deliverablePostsPerMonth } from '@/lib/pipeline/capacity';
import BetaAdmin from './BetaAdmin';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function AdminBetaPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const [coupons, stats] = await Promise.all([listCoupons(), betaStats()]);
  const capacity = deliverablePostsPerMonth();

  // The share of everything Grove can produce that is currently being given
  // away. This is the number that decides whether the beta is still affordable,
  // and it is not visible anywhere else.
  const share = capacity > 0 ? Math.round((stats.committedPostsPerMonth / capacity) * 100) : 0;

  const cards = [
    { label: 'Live beta accounts', value: String(stats.active) },
    { label: 'Expired (convertible)', value: String(stats.expired) },
    { label: 'Free posts / month', value: stats.committedPostsPerMonth.toLocaleString() },
    { label: 'Share of capacity', value: `${share}%`, alarm: share > 50 },
  ];

  return (
    <>
      <DashHeader title="Beta codes" subtitle="Free access, handed out and accounted for" />
      <div className="gv-body">
        <div style={{ maxWidth: 920, margin: '0 auto 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }} className="gv-grid5">
            {cards.map((c) => (
              <div key={c.label} className="gv-card" style={{
                background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 12, color: 'var(--gv-dim)' }}>{c.label}</div>
                <div style={{
                  fontSize: 26, fontWeight: 700, margin: '5px 0 0', letterSpacing: '-0.01em',
                  color: c.alarm ? 'var(--gv-red-text)' : 'var(--gv-ink)',
                }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', margin: '10px 0 0', lineHeight: 1.55 }}>
            Grove can produce about {capacity.toLocaleString()} posts a month in total. Beta grants come out of
            that same pool, so free posts and paid posts compete — raise the scheduler frequency in{' '}
            <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>vercel.json</code> before handing out
            more than the platform can make.
          </p>
        </div>
        <BetaAdmin initialCoupons={coupons} />
      </div>
    </>
  );
}
