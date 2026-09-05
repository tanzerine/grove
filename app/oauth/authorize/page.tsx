/**
 * The consent screen — the only thing standing between a registered client and
 * a customer's content.
 *
 * DELIBERATELY A PLAIN FORM. No client component, no fetch, no JavaScript at
 * all: two submit buttons and a native POST, so the flow works in whatever
 * browser a CLI happened to open and there is no hydration step between the
 * customer reading the screen and the button doing what it says.
 *
 * Everything in the hidden inputs is re-validated by the POST handler with the
 * same `checkAuthorize` this page used, so tampering with a field buys nothing
 * — the fields are a transport for the request, not a source of authority.
 */
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase } from '@/lib/seo';
import { mcpResourceUri } from '@/lib/mcp/oauth-metadata';
import { authorizeRedirect, checkAuthorize, type AuthorizeParams } from '@/lib/mcp/oauth';
import GroveMark from '@/components/GroveMark';

export const dynamic = 'force-dynamic';

const DIM = 'var(--gv-dim)';
const MONO = "'DM Mono', ui-monospace, monospace";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  const params: AuthorizeParams = {
    client_id: one(sp.client_id),
    redirect_uri: one(sp.redirect_uri),
    response_type: one(sp.response_type) || 'code',
    code_challenge: one(sp.code_challenge),
    code_challenge_method: one(sp.code_challenge_method) || 'S256',
    scope: one(sp.scope) || null,
    state: one(sp.state) || null,
    resource: one(sp.resource) || null,
  };

  const admin = supabaseAdmin();
  const { data: client } = params.client_id
    ? await admin.from('oauth_clients').select('client_id,client_name,redirect_uris').eq('client_id', params.client_id).maybeSingle()
    : { data: null };

  const check = checkAuthorize(params, client as any, mcpResourceUri(appBase()));

  if (!check.ok) {
    // A bad redirect_uri is fatal: bouncing an error to an unverified URI is
    // an open redirect, and an open redirect on an OAuth endpoint is how a
    // consent screen gets used as a stepping stone.
    if (check.kind === 'fatal') return <Fatal error={check.error} description={check.description} />;
    redirect(authorizeRedirect(params.redirect_uri, appBase(), { error: check.error, description: check.description }, params.state));
  }

  // Signed in? The customer has to be, and coming back here afterwards is the
  // whole point — AuthForm already honours ?next=.
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    const self = new URL('/oauth/authorize', appBase());
    for (const [k, v] of Object.entries(params)) if (v) self.searchParams.set(k, String(v));
    redirect(`/login?next=${encodeURIComponent(self.pathname + self.search)}`);
  }

  // What they are about to hand over, named concretely. RLS-scoped, so this is
  // exactly the set of sites the resulting token would reach.
  const { data: domains } = await sb.from('domains').select('id,hostname').order('created_at', { ascending: true });
  const siteRows = (domains ?? []).map((d: any) => ({ id: d.id as string, hostname: d.hostname as string }));
  const sites = siteRows.map((s) => s.hostname);

  const scopes = check.ok ? check.scopes : [];
  const writes = scopes.includes('posts:write');
  const clientName = (client as any)?.client_name ?? 'An MCP client';

  return (
    <main className="gv-onb">
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden><span className="b1" /><span className="b2" /></div>
      <div className="gv-onb-in" style={{ maxWidth: 560 }}>
        <span className="gv-onb-eyebrow">Connect an agent</span>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(26px, 6.5vw, 34px)' }}>
          Let <span style={{ fontFamily: MONO, color: 'var(--gv-accent-ink)' }}>{clientName}</span> reach your articles?
        </h1>
        <p className="gv-onb-lede">
          It asked for access to the grove account for <b style={{ color: 'var(--gv-ink)' }}>{user!.email}</b>.
          {' '}Only approve this if you just started it yourself.
        </p>

        <div className="gv-onb-card" style={{ marginTop: 26, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Row on label="Read your published articles" note="Titles, bodies, covers and where each one is published." />
          <Row
            on={writes}
            label="Record where they went live"
            note="Which articles your site has taken, and pointing grove's canonical URLs at your own."
          />
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--gv-soft)', fontWeight: 600, marginBottom: 3 }}>
              {sites.length ? 'On these sites' : 'You have no sites connected yet'}
            </div>
            {!sites.length ? (
              <div style={{ fontSize: 12.5, color: DIM, marginTop: 5, lineHeight: 1.6 }}>
                Connect a domain first and the agent will see nothing until you do.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: DIM, marginBottom: 10, lineHeight: 1.55 }}>
                  Untick any it should not see. The grant covers exactly what you tick &mdash; a site you add
                  later is not included until you approve the agent again.
                </div>
                {/* Named checkboxes rather than a summary line: an agency running
                    six client blogs out of one account should be able to let one
                    client's agent near one client's articles. All ticked by
                    default, because that is the common case and the screen
                    should not make the ordinary customer do work. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {siteRows.map((s) => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--gv-soft)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        name="site"
                        value={s.id}
                        defaultChecked
                        form="consent"
                        style={{ accentColor: 'var(--gv-accent)', width: 15, height: 15 }}
                      />
                      <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{s.hostname}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--gv-fainter)', lineHeight: 1.6, marginTop: 14 }}>
          It cannot publish, delete or edit an article, change your plan, or see your billing. You can disconnect
          it at any time from <span style={{ fontFamily: MONO }}>Content API</span>.
        </p>

        <form id="consent" method="post" action="/api/oauth/consent" style={{ display: 'flex', gap: 12, marginTop: 26, alignItems: 'center' }}>
          {Object.entries(params).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={String(v)} /> : null,
          )}
          <input type="hidden" name="offered_any" value={siteRows.length ? '1' : '0'} />

          <button type="submit" name="decision" value="allow" className="gv-onb-btn">Allow access</button>
          <button type="submit" name="decision" value="deny" className="gv-onb-ghost">Cancel</button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--gv-fainter)', marginTop: 22, lineHeight: 1.6, fontFamily: MONO, wordBreak: 'break-all' }}>
          Returns to {params.redirect_uri}
        </p>
      </div>
    </main>
  );
}

function Row({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', opacity: on ? 1 : 0.4 }}>
      <span
        aria-hidden
        style={{
          width: 16, height: 16, borderRadius: 5, flexShrink: 0, marginTop: 2,
          background: on ? 'var(--gv-accent)' : 'transparent',
          border: on ? 'none' : '1px solid rgba(255,255,255,0.2)',
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, color: 'var(--gv-ink)', fontWeight: 500 }}>
          {label}{!on && <span style={{ color: DIM, fontWeight: 400 }}> — not requested</span>}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: DIM, lineHeight: 1.55, marginTop: 2 }}>{note}</span>
      </span>
    </div>
  );
}

/**
 * Rendered rather than redirected. If we cannot trust the redirect URI we
 * cannot send anything to it, so the customer — who is the only person who can
 * act on this — is told directly.
 */
function Fatal({ error, description }: { error: string; description: string }) {
  return (
    <main className="gv-onb">
      <GroveMark />
      <div className="gv-onb-in" style={{ maxWidth: 520 }}>
        <span className="gv-onb-eyebrow" style={{ color: 'var(--gv-red-text)' }}>Request refused</span>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(24px, 6vw, 32px)' }}>grove can&rsquo;t approve this</h1>
        <p className="gv-onb-lede">{description}</p>
        <p style={{ fontSize: 13, color: DIM, marginTop: 20, lineHeight: 1.6 }}>
          Nothing was shared, and you have not been sent anywhere. If you started this from a coding agent, it may
          be misconfigured &mdash; the setup steps are on{' '}
          <a href="/dashboard/mcp" style={{ color: 'var(--gv-accent-ink)' }}>Content API</a>.
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--gv-fainter)', marginTop: 18, fontFamily: MONO }}>{error}</p>
      </div>
    </main>
  );
}
