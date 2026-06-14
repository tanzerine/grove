import { supabaseServer } from '@/lib/supabase/server';
import WriteDesk from './WriteDesk';

export default async function WritePage() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('id, hostname').limit(1);
  const domain = domains?.[0];

  return (
    <>
      <h1 style={{ fontFamily: 'Clash Display', fontSize: 32, margin: 0 }}>Writing desk</h1>
      <p className="lede" style={{ marginTop: 8, maxWidth: 600 }}>
        Write a post in your own words, or think out loud and let grove turn an idea into a draft.
        Nothing here publishes on its own — you stay in the driver&apos;s seat.
      </p>

      {domain ? (
        <WriteDesk domainId={domain.id} hostname={domain.hostname} />
      ) : (
        <p className="lede" style={{ marginTop: 24 }}>
          Add a domain first to start writing.
        </p>
      )}
    </>
  );
}
