import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { listMeetings } from '@/lib/meetings-store';
import MeetingsAdmin from './MeetingsAdmin';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function AdminMeetingsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const rows = await listMeetings(100);

  return (
    <>
      <DashHeader title="Meetings" subtitle="Offer call times to a prospect, get their pick, confirm" />
      <div className="gv-body">
        <MeetingsAdmin initialRows={rows} />
      </div>
    </>
  );
}
