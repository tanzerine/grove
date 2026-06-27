import { supabaseServer } from '@/lib/supabase/server';
import WriteDesk from './WriteDesk';

export default async function WritePage() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('id, hostname').limit(1);
  const domain = domains?.[0];

  return (
    <>
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Writing desk</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>write it yourself, or think out loud and let grove draft it</div>
        </div>
      </header>
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
