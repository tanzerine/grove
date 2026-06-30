import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import WriteDesk from '../WriteDesk';
import { DashHeader } from '../../gv-chrome';

export default async function IdeaStudioPage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="Idea studio" subtitle="think out loud — grove suggests angles you can write yourself or hand off" />
      <div className="gv-body">
        {domain ? (
          <WriteDesk domainId={domain.id} hostname={domain.hostname} mode="idea" />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
