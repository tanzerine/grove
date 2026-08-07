import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { listFeedback, feedbackStats } from '@/lib/feedback-store';
import FeedbackAdmin from './FeedbackAdmin';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function AdminFeedbackPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const [rows, stats] = await Promise.all([listFeedback({ limit: 200 }), feedbackStats()]);

  const cards: { label: string; value: string; tone?: 'alarm' | 'good' }[] = [
    { label: 'Needs you', value: String(stats.open), tone: stats.open ? 'alarm' : undefined },
    { label: 'Blocking complaints', value: String(stats.blockers), tone: stats.blockers ? 'alarm' : undefined },
    { label: 'Ready to publish', value: String(stats.publishable), tone: stats.publishable ? 'good' : undefined },
    { label: 'Average rating', value: stats.avgRating === null ? '—' : `${stats.avgRating}/5` },
  ];

  return (
    <>
      <DashHeader title="Feedback" subtitle="Testimonials, shortcomings & complaints" />
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
                  color: c.tone === 'alarm' ? 'var(--gv-red-text)'
                       : c.tone === 'good' ? 'var(--gv-accent-ink)' : 'var(--gv-ink)',
                }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        </div>
        <FeedbackAdmin initialRows={rows} />
      </div>
    </>
  );
}
