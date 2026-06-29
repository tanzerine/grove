import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { DashHeader } from '../gv-chrome';

export default async function Page() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const { data: posts } = await sb.from('posts').select('*').eq('domain_id', domain?.id).eq('status', 'published').order('published_at', { ascending: false });

  return (
    <>
      <DashHeader title="Published" subtitle="everything that’s live on your blog" />
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
