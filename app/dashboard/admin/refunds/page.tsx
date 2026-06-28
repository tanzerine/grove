import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import RefundsAdmin, { type RefundRow } from './RefundsAdmin';

export const dynamic = 'force-dynamic';

export default async function RefundsAdminPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  // Owner-only. Non-admins are bounced to their dashboard (no info leak).
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  // Service-role read: the admin needs to see every user's request, which RLS
  // (read-own) would otherwise hide. Access is already gated by the email check.
  let rows: RefundRow[] = [];
  try {
    const { data } = await supabaseAdmin()
      .from('refund_requests')
      .select('id, email, plan, reason, feedback, comeback, status, amount_cents, currency, created_at, processed_at, processed_by')
      .order('created_at', { ascending: false })
      .limit(200);
    rows = (data as RefundRow[]) ?? [];
  } catch { /* table may not be migrated yet */ }

  return (
    <>
      <header className="gv-header">
        <h1 style={{ fontSize: 17, fontWeight: 700, color: '#eef1ea', margin: 0 }}>Refund requests</h1>
      </header>
      <div className="gv-body">
        <RefundsAdmin initialRows={rows} />
      </div>
    </>
  );
}
