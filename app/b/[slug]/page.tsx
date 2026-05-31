import { supabaseAdmin } from '@/lib/supabase/admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('hostname').eq('blog_slug', slug).single();
  return { title: `${domain?.hostname ?? 'grove blog'} — articles`, description: `Posts by ${domain?.hostname}` };
}

export default async function BlogIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug').eq('blog_slug', slug).single();
  if (!domain) notFound();
  const { data: posts } = await sb
    .from('posts').select('slug,title,meta_description,published_at')
    .eq('domain_id', domain.id).eq('status', 'published').order('published_at', { ascending: false });

  return (
    <main className="wrap" style={{ maxWidth: 760, padding: '60px 28px' }}>
      <h1 className="display" style={{ fontSize: 56 }}>The {domain.hostname} blog</h1>
      <p className="lede">Grown by grove. Updated on autopilot.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 40 }}>
        {(posts ?? []).map((p) => (
          <Link key={p.slug} href={`/b/${slug}/${p.slug}`} style={{ display: 'block', borderBottom: '1px solid var(--line)', paddingBottom: 24 }}>
            <h2 style={{ fontFamily: 'Clash Display', fontSize: 26, margin: 0 }}>{p.title}</h2>
            <p style={{ color: 'var(--clay)', margin: '6px 0 0' }}>{p.meta_description}</p>
            <span className="mono" style={{ fontSize: 12, color: 'var(--clay)' }}>{new Date(p.published_at!).toLocaleDateString()}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
