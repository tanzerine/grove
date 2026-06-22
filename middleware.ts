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
  //
  // This block must NEVER throw: middleware runs on (almost) every route, so an
  // unhandled error here returns MIDDLEWARE_INVOCATION_FAILED — a site-wide 500
  // on the landing page and all. The two ways it can blow up are a misconfigured
  // deploy (env unset → createServerClient throws) and an unreachable auth
  // backend (e.g. a paused Supabase project → getUser's fetch rejects). In both
  // cases we degrade instead of crashing: treat the request as logged-out, let
  // public pages through, and only bounce the gated areas to /login.
  const path = req.nextUrl.pathname;
  const res = NextResponse.next();

  let user: { id: string } | null = null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) =>
            toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options as any)),
        },
      });
      ({ data: { user } } = await supabase.auth.getUser());
    } catch {
      // Auth backend unreachable or client misconfigured. Fail open for public
      // routes; the gate below still protects /dashboard & /onboarding.
      user = null;
    }
  }

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
