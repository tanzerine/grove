import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { subdomainSlugFromHost } from '@/lib/seo';

const PROTECTED = ['/dashboard', '/onboarding'];

export async function middleware(req: NextRequest) {
  // ── 1. Blog subdomains: {slug}.{GROVE_BLOG_ROOT_DOMAIN} ──────────────────
  // Rewrite the clean public URLs onto the internal /b/{slug} routes. No-op
  // when the env is unset or the host isn't a blog subdomain.
  const sub = subdomainSlugFromHost(req.headers.get('host'));
  if (sub) {
    const url = req.nextUrl.clone();
    const p = url.pathname;

    // same-app endpoints that must pass through untouched (tracker, assets)
    if (p.startsWith('/api/') || p.startsWith('/_next') || p === '/favicon.ico' || p === '/embed.js') {
      return NextResponse.next();
    }
    // canonicalize the internal path shape if someone lands on it directly
    if (p === `/b/${sub}` || p.startsWith(`/b/${sub}/`)) {
      url.pathname = p.slice(`/b/${sub}`.length) || '/';
      return NextResponse.redirect(url, 301);
    }
    if (p === '/robots.txt' || p === '/sitemap.xml' || p === '/rss.xml' || p === '/llms.txt') {
      url.pathname = `/b/${sub}${p}`;
      return NextResponse.rewrite(url);
    }
    url.pathname = p === '/' ? `/b/${sub}` : `/b/${sub}${p}`;
    return NextResponse.rewrite(url);
  }

  // ── 2. App auth — refresh the session on EVERY route ─────────────────────
  // Supabase rotates the access/refresh token pair on expiry, and the rotated
  // cookies can only be persisted from a place that can write to the response.
  // Server components can't (their setAll is a no-op), so if we only refreshed
  // on protected routes the session would silently die after a visit to the
  // landing page. Running getUser here on every non-static request keeps the
  // cookie fresh everywhere and is what lets "log in once, stay logged in" hold.
  const path = req.nextUrl.pathname;
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) =>
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options as any)),
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  // Gate protected areas; everything else passes through with the refreshed cookie.
  if (!user && PROTECTED.some((pre) => path.startsWith(pre))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Run broadly so subdomain hosts get rewritten; static assets excluded.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|embed.js).*)'],
};
