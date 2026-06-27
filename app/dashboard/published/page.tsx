import { supabaseServer } from '@/lib/supabase/server';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('id,blog_slug').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb.from('posts').select('*').eq('domain_id', domain?.id).eq('status', 'published').order('published_at', { ascending: false });

  return (
    <>
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Published</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>everything that’s live on your blog</div>
        </div>
      </header>
      <div className="gv-body">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(posts ?? []).map((p) => (
          <a key={p.id} className="post-row" href={`/b/${domain?.blog_slug}/${p.slug}`} target="_blank" rel="noreferrer">
            <div className="pthumb" />
            <div className="pbody">
              <div className="ptitle">{p.title}</div>
              <div className="pmeta">{new Date(p.published_at).toLocaleDateString()} · {p.reads} reads</div>
            </div>
            <span className="badge live"><span className="d" />LIVE</span>
          </a>
        ))}
        {(posts?.length ?? 0) === 0 && <p className="lede">Nothing published yet.</p>}
      </div>
      </div>
    </>
  );
}
