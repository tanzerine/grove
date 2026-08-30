import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { DashHeader } from '../gv-chrome';
import { blogHomeUrl, canonicalBaseFor } from '@/lib/seo';
import { getT } from '@/lib/i18n/server';

export default async function Page() {
  const t = await getT();
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const { data: posts } = await sb.from('posts').select('*').eq('domain_id', domain?.id).eq('status', 'published').order('published_at', { ascending: false });

  // "everything that's live on your blog" means the reader-facing copy, so this
  // resolves through the shared builders — a customer with their own base gets
  // their own URLs here, not the /b/ mirror.
  const blogBase = domain?.blog_slug ? blogHomeUrl(domain.blog_slug, canonicalBaseFor(domain)) : null;

  return (
    <>
      <DashHeader title={t('Published')} subtitle={t('everything that’s live on your blog')} />
      <div className="gv-body">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(posts ?? []).map((p) => (
          <a key={p.id} className="post-row" href={`${blogBase}/${p.slug}`} target="_blank" rel="noreferrer">
            <div className="pthumb" />
            <div className="pbody">
              <div className="ptitle">{p.title}</div>
              <div className="pmeta">{new Date(p.published_at).toLocaleDateString()} · {p.reads} reads</div>
            </div>
            <span className="badge live"><span className="d" />LIVE</span>
          </a>
        ))}
        {(posts?.length ?? 0) === 0 && <p className="lede">{t('Nothing published yet.')}</p>}
      </div>
      </div>
    </>
  );
}
