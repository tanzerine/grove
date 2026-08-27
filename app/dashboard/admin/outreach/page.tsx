import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { listCoupons } from '@/lib/beta-store';
import { listProspects, outreachStats } from '@/lib/outreach/store';
import { hasRedditAuth } from '@/lib/outreach/reddit';
import OutreachAdmin from './OutreachAdmin';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function AdminOutreachPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const [rows, stats, coupons] = await Promise.all([listProspects({ limit: 200 }), outreachStats(), listCoupons()]);

  // Only codes that would actually work if a stranger typed them today. A dead
  // code in the picker is a dead code in twenty private messages.
  const usable = coupons
    .filter((c) => c.problem === null)
    .map((c) => ({ code: c.code, label: c.label, postsQuota: c.posts_quota, days: c.days }));

  const cards = [
    { label: 'To review', value: String(stats.open) },
    { label: 'DMs sent', value: String(stats.contacted) },
    { label: 'Replied', value: `${stats.replied}`, sub: stats.contacted ? `${stats.replyRate}%` : null },
    { label: 'Joined the beta', value: String(stats.joined) },
  ];

  return (
    <>
      <DashHeader title="Outreach" subtitle="Find beta testers who already said they have the problem" />
      <div className="gv-body">
        <div style={{ maxWidth: 920, margin: '0 auto 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }} className="gv-grid5">
            {cards.map((c) => (
              <div key={c.label} style={{
                background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 12, color: 'var(--gv-dim)' }}>{c.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, margin: '5px 0 0', letterSpacing: '-0.01em', color: 'var(--gv-ink)' }}>
                  {c.value}
                  {c.sub ? <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--gv-faint)' }}> · {c.sub}</span> : null}
                </div>
              </div>
            ))}
          </div>
          {/* Reddit 403s anonymous reads from cloud IPs, so on Vercel a scan
              without credentials fails every time. Say so before the click,
              not in the error afterwards. */}
          {!hasRedditAuth() && (
            <p style={{ fontSize: 12.5, color: 'var(--gv-amber)', margin: '10px 0 0', lineHeight: 1.55 }}>
              Reading Reddit anonymously — this works locally but Reddit blocks datacenter IPs, so a scan
              from the deployed app will almost certainly 403. Set{' '}
              <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>GROVE_REDDIT_CLIENT_ID</code> and{' '}
              <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>GROVE_REDDIT_CLIENT_SECRET</code>{' '}
              (a “script” app at reddit.com/prefs/apps, two minutes) to read over app-only OAuth instead.
              It is a read-only token — it cannot post or message.
            </p>
          )}
          {usable.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--gv-amber)', margin: '10px 0 0', lineHeight: 1.55 }}>
              No live beta code to offer. Mint one on the Beta codes page first — a DM whose only ask is
              “reply to me” converts far worse than one with a code in it.
            </p>
          )}
        </div>
        <OutreachAdmin initialRows={rows} couponCodes={usable} />
      </div>
    </>
  );
}
