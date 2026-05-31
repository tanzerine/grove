import { supabaseServer } from '@/lib/supabase/server';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('id').limit(1);
  const { data: posts } = await sb.from('posts').select('title, reads, published_at').eq('domain_id', domains?.[0]?.id).eq('status', 'published');
  const total = posts?.reduce((s, p) => s + (p.reads ?? 0), 0) ?? 0;

  return (
    <>
      <h2 className="h2">Analytics</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 18 }}>
        <Stat label="Total reads" value={total.toLocaleString()} />
        <Stat label="Published posts" value={String(posts?.length ?? 0)} />
        <Stat label="Avg reads / post" value={posts?.length ? Math.round(total / posts.length).toString() : '—'} />
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'white', padding: 24, borderRadius: 14, border: '1px solid var(--line)' }}>
      <div style={{ fontFamily: 'Clash Display', fontSize: 34, color: 'var(--moss)' }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--clay)' }}>{label}</div>
    </div>
  );
}
