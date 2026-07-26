import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import WriteSurface from './WriteSurface';
import { DashHeader } from '../gv-chrome';

export default async function WritePage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="Write" subtitle="a blank page — write it yourself, or start from Idea studio / SEO set on the right. Anything grove writes for you opens right here. Generate images from the toolbar, then pick when it publishes." />
      <div className="gv-body" style={{ maxWidth: 1440 }}>
        {domain ? (
          <WriteSurface domainId={domain.id} hostname={domain.hostname} />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
