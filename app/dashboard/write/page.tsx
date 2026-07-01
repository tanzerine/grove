import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import WriteWorkspace from './WriteWorkspace';
import { DashHeader } from '../gv-chrome';

export default async function WritePage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="Write" subtitle="a blank page by default — or pick Idea studio / SEO set on the left" />
      <div className="gv-body">
        {domain ? (
          <WriteWorkspace domainId={domain.id} hostname={domain.hostname} />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
