import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { todayKey } from '@/lib/operator-plan';
import { planBoard } from '@/lib/operator-plan-store';
import { DashHeader } from '../../gv-chrome';
import PlanAdmin from './PlanAdmin';

export const dynamic = 'force-dynamic';

/**
 * The operator's planner. Owner-only, like the rest of /dashboard/admin, and
 * deliberately untranslated for the same reason the other admin pages are:
 * the only person who reads it also reads the code.
 */
export default async function PlanPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  // This is the SERVER's today (UTC on Vercel). The client re-anchors to the
  // operator's own date on mount — see PlanAdmin. Rendering something correct
  // for most of the day beats rendering an empty shell for all of it.
  const today = todayKey();
  const board = await planBoard(today);

  return (
    <>
      <DashHeader title="Planner" subtitle="Month goals, week focus, day tasks — for running the service" />
      <div className="gv-body">
        <PlanAdmin initial={board} serverToday={today} />
      </div>
    </>
  );
}
