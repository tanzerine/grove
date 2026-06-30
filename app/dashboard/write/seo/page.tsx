import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import WriteDesk from '../WriteDesk';
import { DashHeader } from '../../gv-chrome';

export default async function SeoSetPage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="SEO set" subtitle="cover a whole topic — grove drafts one focused page per real search" />
      <div className="gv-body">
        {domain ? (
          <WriteDesk domainId={domain.id} hostname={domain.hostname} mode="seo" />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
