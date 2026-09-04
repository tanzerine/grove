import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { getReached } from '@/lib/journey-store';
import { dayOf, END } from '@/lib/journey';
import { DashHeader } from '../../gv-chrome';
import JourneyBoard from './JourneyBoard';

export const dynamic = 'force-dynamic';

/**
 * The journey page. Owner-only and untranslated, like the rest of
 * /dashboard/admin.
 *
 * It puts two ledgers side by side on purpose. Every other admin surface here
 * reports one of them — the overview counts customers and MRR, the planner
 * counts my tasks — and read alone, each is survivable. The build ledger next
 * to the reach ledger is the only view that states the actual position, which
 * is why this page exists and why nothing on it is softened.
 *
 * The left column is fixed history from the repo (lib/journey.ts). The right
 * column is live (lib/journey-store.ts), so the day the reach numbers move,
 * this page moves with them.
 */
export default async function JourneyPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const r = await getReached();

  return (
    <>
      <DashHeader
        title="Journey"
        subtitle={`The first ${dayOf(END)} days — what got built, and what it reached`}
      />
      <div className="gv-body">
        <JourneyBoard r={r} />
      </div>
    </>
  );
}
