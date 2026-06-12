import { supabaseAdmin } from '@/lib/supabase/admin';
import { jsonLdScript, blogHomeUrl, blogPostUrl, subdomainSlugFromHost } from '@/lib/seo';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('hostname').eq('blog_slug', slug).single();
  const url = blogHomeUrl(slug);
  return {
    title: `${domain?.hostname ?? 'grove blog'} — articles`,
    description: `Posts by ${domain?.hostname}`,
    alternates: {
      canonical: url,
      types: { 'application/rss+xml': `${url}/rss.xml` },
    },
    openGraph: {
      title: `${domain?.hostname ?? 'grove blog'} — articles`,
      description: `Posts by ${domain?.hostname}`,
      url,
      type: 'website',
      siteName: domain?.hostname,
    },
  };
}

export default async function BlogIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug').eq('blog_slug', slug).single();
  if (!domain) notFound();
  const { data: posts } = await sb
    .from('posts').select('slug,title,meta_description,published_at,cover_image_url')
    .eq('domain_id', domain.id).eq('status', 'published').order('published_at', { ascending: false });

  // On a blog subdomain the middleware strips /b/{slug}, so links are root-relative there.
  const onSubdomain = !!subdomainSlugFromHost((await headers()).get('host'));
  const prefix = onSubdomain ? '' : `/b/${slug}`;

  const blogLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `The ${domain.hostname} blog`,
    url: blogHomeUrl(slug),
    blogPost: (posts ?? []).slice(0, 20).map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: blogPostUrl(slug, p.slug!),
      datePublished: p.published_at ?? undefined,
    })),
  };

  return (
    <main className="wrap" style={{ maxWidth: 760, padding: '60px 28px' }}>
      <h1 className="display" style={{ fontSize: 56 }}>The {domain.hostname} blog</h1>
      <p className="lede">Grown by grove. Updated on autopilot.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 40 }}>
        {(posts ?? []).map((p) => (
          <Link key={p.slug} href={`${prefix}/${p.slug}`} style={{ display: 'flex', gap: 20, alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontFamily: 'Clash Display', fontSize: 26, margin: 0 }}>{p.title}</h2>
              <p style={{ color: 'var(--clay)', margin: '6px 0 0' }}>{p.meta_description}</p>
              <span className="mono" style={{ fontSize: 12, color: 'var(--clay)' }}>{new Date(p.published_at!).toLocaleDateString()}</span>
            </div>
            {p.cover_image_url && (
              <img
                src={p.cover_image_url}
                alt=""
                loading="lazy"
                style={{ width: 148, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)', flexShrink: 0 }}
              />
            )}
          </Link>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(blogLd) }} />
    </main>
  );
}
