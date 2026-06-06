import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname').eq('blog_slug', slug).single();
  if (!domain) return {};
  const { data: p } = await sb.from('posts').select('meta_title,meta_description').eq('domain_id', domain.id).eq('slug', post).single();
  return {
    title: p?.meta_title,
    description: p?.meta_description,
    openGraph: { title: p?.meta_title, description: p?.meta_description, type: 'article' },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug').eq('blog_slug', slug).single();
  if (!domain) notFound();
  const { data: p } = await sb
    .from('posts').select('title,body_md,published_at,meta_description,reads,id')
    .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single();
  if (!p) notFound();

  // increment reads (best-effort)
  await sb.from('posts').update({ reads: (p.reads ?? 0) + 1 }).eq('id', p.id);

  const html = mdToHtml(p.body_md ?? '');
  const toc = extractToc(p.body_md ?? '');

  return (
    <main className="wrap" style={{ maxWidth: 720, padding: '60px 28px' }}>
      <a href={`/b/${slug}`} className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← {domain.hostname}</a>
      <h1 className="display" style={{ fontSize: 46, marginTop: 18 }}>{p.title}</h1>
      <p className="mono" style={{ color: 'var(--clay)', fontSize: 12 }}>{new Date(p.published_at!).toLocaleDateString()}</p>
      {toc.length >= 2 && (
        <nav
          aria-label="Table of contents"
          style={{
            marginTop: 30,
            padding: '20px 24px',
            background: 'white',
            border: '1px solid var(--line)',
            borderRadius: 14,
          }}
        >
          <div
            className="mono"
            style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 10 }}
          >
            Contents
          </div>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.7 }}>
            {toc.map((item, i) => (
              <li
                key={`${item.id}-${i}`}
                style={{ paddingLeft: item.level === 3 ? 16 : 0, fontSize: item.level === 3 ? 14 : 15 }}
              >
                <a href={`#${item.id}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <article
        className="prose"
        style={{ marginTop: 30, padding: '40px 36px', background: 'white', border: '1px solid var(--line)', borderRadius: 14, maxWidth: 'none' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
