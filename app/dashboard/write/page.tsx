import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import WriteDesk from './WriteDesk';
import { DashHeader } from '../gv-chrome';

export default async function WritePage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="Writing desk" subtitle="write it yourself, or think out loud and let grove draft it" />
      <div className="gv-body">
        <p className="lede" style={{ maxWidth: 600 }}>
          Write a post in your own words, or think out loud and let grove turn an idea into a draft.
          Nothing here publishes on its own — you stay in the driver&apos;s seat.
        </p>
        {domain ? (
          <WriteDesk domainId={domain.id} hostname={domain.hostname} />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
