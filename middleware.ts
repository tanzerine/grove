import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { subdomainSlugFromHost, normalizeBlogHostname, appBase, blogRootDomain } from '@/lib/seo';

const PROTECTED = ['/dashboard', '/onboarding'];

/** Serve a blog on a non-app host: rewrite the clean public URLs onto the
 *  internal /b/{slug} routes. Shared by grove's own {slug}.{root} subdomains
 *  and customer CNAME'd hostnames — the two must never diverge in path shape. */
function rewriteBlogHost(req: NextRequest, slug: string): NextResponse {
  const url = req.nextUrl.clone();
  const p = url.pathname;

  // same-app endpoints that must pass through untouched (tracker, assets)
  if (p.startsWith('/api/') || p.startsWith('/_next') || p === '/favicon.ico' || p === '/embed.js') {
    return NextResponse.next();
  }
  // canonicalize the internal path shape if someone lands on it directly
  if (p === `/b/${slug}` || p.startsWith(`/b/${slug}/`)) {
    url.pathname = p.slice(`/b/${slug}`.length) || '/';
    return NextResponse.redirect(url, 301);
  }
  url.pathname = p === '/' ? `/b/${slug}` : `/b/${slug}${p}`;
  return NextResponse.rewrite(url);
}

// ── customer CNAME'd hostnames → blog_slug ─────────────────────────────────
// blog.customer.com points at us; the mapping lives in
// domains.custom_blog_hostname, so resolving it needs the DB. Cached per edge
// isolate: hits stay hot 5 min, misses 1 min (a fresh DNS setup shouldn't sit
// behind a long negative cache). Must never throw: like the auth block below,
// an unhandled error here is a site-wide 500.
const CUSTOM_HOST_TTL_MS = 5 * 60_000;
const CUSTOM_HOST_MISS_TTL_MS = 60_000;
const customHostCache = new Map<string, { slug: string | null; exp: number }>();

async function customBlogSlug(rawHost: string | null): Promise<string | null> {
  const host = normalizeBlogHostname(rawHost);
  if (!host || host.endsWith('.vercel.app')) return null;

  // the app's own host is never a customer blog host — bail before any I/O so
  // normal traffic pays nothing for this feature
  let appHost = '';
  try { appHost = new URL(appBase()).hostname.toLowerCase(); } catch { /* keep '' */ }
  if (host === appHost || host === `www.${appHost}` || appHost === `www.${host}`) return null;
  const root = blogRootDomain();
  if (root && (host === root || host.endsWith(`.${root}`))) return null;

  const cached = customHostCache.get(host);
  if (cached && cached.exp > Date.now()) return cached.slug;

  let slug: string | null = null;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && key) {
    try {
      const res = await fetch(
        `${sbUrl}/rest/v1/domains?custom_blog_hostname=eq.${encodeURIComponent(host)}&select=blog_slug&limit=1`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } },
      );
      // a pre-0026 DB 400s on the unknown column — any non-ok is just "no match"
      if (res.ok) {
        const rows = (await res.json()) as { blog_slug?: string }[];
        slug = rows?.[0]?.blog_slug ?? null;
      }
    } catch {
      slug = null; // DB unreachable — serve the request as a normal app route
    }
  }
  customHostCache.set(host, { slug, exp: Date.now() + (slug ? CUSTOM_HOST_TTL_MS : CUSTOM_HOST_MISS_TTL_MS) });
  return slug;
}

export async function middleware(req: NextRequest) {
  // ── 1. Blog hosts ─────────────────────────────────────────────────────────
  // {slug}.{GROVE_BLOG_ROOT_DOMAIN} first (pure string check, no I/O), then
  // customer CNAME'd hostnames (cached DB lookup). No-op on the app's host.
  const sub = subdomainSlugFromHost(req.headers.get('host'));
  if (sub) return rewriteBlogHost(req, sub);

  const custom = await customBlogSlug(req.headers.get('host'));
  if (custom) return rewriteBlogHost(req, custom);

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
