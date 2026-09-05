/**
 * /dashboard/mcp — the content-layer integration.
 *
 * The Embed page answers "show grove's blog inside my page". This one answers
 * the question customers with a real blog already ask instead: "I have a
 * content layer — put the articles in it." The product surface for that is an
 * MCP server their coding agent connects to, so the page is mostly: make a key,
 * paste one command, watch articles land.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase, canonicalBaseFor } from '@/lib/seo';
import { keyState } from '@/lib/mcp/keys';
import { TOOLS } from '@/lib/mcp/tools';
import { DashHeader } from '../gv-chrome';
import Icon from '../gv-icons';
import KeyManager, { type KeyRow } from './KeyManager';
import GrantList from './GrantList';
import { summarizeGrants, toView } from '@/lib/mcp/grants';
import { getT, getUiLocale } from '@/lib/i18n/server';
import { intlLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const t = await getT();
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  // Domains through the user's own client (RLS); keys through the service-role
  // client because mcp_keys is deliberately policy-less (migration 0036) —
  // scoped by hand to this user, which is the access check.
  const { data: domains } = await sb
    .from('domains')
    .select('id,hostname,blog_slug,canonical_blog_base,custom_blog_hostname')
    .order('created_at', { ascending: true });
  const sites = domains ?? [];

  const admin = supabaseAdmin();
  const { data: keyRows } = user
    ? await admin
        .from('mcp_keys')
        .select('id,name,key_prefix,domain_id,scopes,created_at,last_used_at,last_tool,calls,revoked_at,expires_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    : { data: [] as any[] };

  const keys: KeyRow[] = (keyRows ?? []).map((k: any) => ({ ...k, state: keyState(k) }));

  // Browser-approved grants. Same service-role reasoning as the keys above:
  // oauth_tokens is policy-less by design (0039), so `.eq('user_id', …)` is the
  // access check. Rotation means one agent owns several rows — summarizeGrants
  // collapses each lineage back into the one thing the customer approved.
  const { data: tokenRows } = user
    ? await admin
        .from('oauth_tokens')
        .select('id,client_id,scopes,created_at,last_used_at,last_tool,calls,revoked_at,expires_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    : { data: [] as any[] };

  const clientIds = [...new Set((tokenRows ?? []).map((r: any) => r.client_id as string))];
  const { data: clientRows } = clientIds.length
    ? await admin.from('oauth_clients').select('client_id,client_name').in('client_id', clientIds)
    : { data: [] as any[] };
  const clientNames = Object.fromEntries((clientRows ?? []).map((c: any) => [c.client_id, c.client_name]));
  // Formatted here, not in the client component: see toView's note on why
  // rendering a date or a relative time during hydration breaks it.
  const dateLocale = intlLocale(await getUiLocale());
  const grants = summarizeGrants((tokenRows ?? []) as any, clientNames)
    .map((g) => toView(g, dateLocale));

  // Delivery state per site — the honest answer to "is my content actually on
  // my site?", which nothing else in the dashboard can tell them once grove
  // stops being the thing that renders it.
  const stats = await Promise.all(sites.map(async (d) => {
    const [{ count: published }, { count: delivered }, { data: last }] = await Promise.all([
      admin.from('posts').select('id', { count: 'exact', head: true }).eq('domain_id', d.id).eq('status', 'published').not('slug', 'is', null),
      admin.from('mcp_deliveries').select('id', { count: 'exact', head: true }).eq('domain_id', d.id),
      admin.from('mcp_deliveries').select('external_url,delivered_at').eq('domain_id', d.id).order('delivered_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      id: d.id,
      hostname: d.hostname,
      published: published ?? 0,
      delivered: delivered ?? 0,
      canonical: canonicalBaseFor(d as any),
      lastUrl: (last as any)?.external_url ?? null,
      lastAt: (last as any)?.delivered_at ?? null,
    };
  }));

  const endpoint = `${appBase()}/api/mcp`;
  const anyDelivered = stats.some((s) => s.delivered > 0);

  return (
    <>
      <DashHeader title={t('Content API')} subtitle={t("grove's articles, inside the blog you already run")} />
      <div className="gv-body">
        <p style={{ fontSize: 14, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '0 0 22px', maxWidth: 640 }}>
          Already have a content layer — MDX in a repo, a CMS, your own pipeline? Connect your coding agent to grove
          over MCP and it pulls finished articles straight into it, in your layer&rsquo;s own shape. No embed script,
          no second blog beside the first.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <KeyManager
              initialKeys={keys}
              sites={sites.map((s) => ({ id: s.id, hostname: s.hostname }))}
              endpoint={endpoint}
            />

            <GrantList initial={grants} />

            <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>{t('Step 3 · Let it work')}</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 14 }}>{t('What your agent can do')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {TOOLS.map((tool) => (
                  <div key={tool.name} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--gv-accent-ink)', background: 'rgba(162,255,1,0.1)', border: '1px solid rgba(162,255,1,0.24)', borderRadius: 6, padding: '2px 7px', flexShrink: 0, marginTop: 1 }}>
                      {tool.name}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.5 }}>
                      {/* First sentence only — the full description is the
                          agent's prompt, not a human's reading material. */}
                      {tool.description.split('. ')[0]}.
                      {tool.scope === 'write' && <span style={{ color: 'var(--gv-fainter)' }}> {t('Needs write-back.')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <details className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18 }}>
              <summary style={{ padding: '18px 22px', cursor: 'pointer', listStyle: 'none' }}>
                <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>{t('Advanced · test it by hand')}</span>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 700, marginTop: 6 }}>{t('It’s a plain HTTP endpoint')}</span>
              </summary>
              <div style={{ padding: '0 22px 22px' }}>
                <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: '8px 0 12px', lineHeight: 1.55 }}>
                  {t('JSON-RPC over a single POST to')} <span className="mono">{endpoint}</span> — no SDK required if you&rsquo;d
                  rather script the import yourself.
                </p>
                <pre style={{ margin: 0, padding: '14px 16px', fontSize: 11.5, lineHeight: 1.6, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0d0e0b', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
{`curl -s ${endpoint} \\
  -H "Authorization: Bearer gv_mcp_YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pull_new","arguments":{"limit":1,"format":"mdx"}}}'`}
                </pre>
              </div>
            </details>
          </div>

          {/* RIGHT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'sticky', top: 84 }}>
            <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{t('On your site')}</div>
              <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 16 }}>{t('what your layer has taken')}</div>

              {!stats.length ? (
                <p style={{ fontSize: 13, color: 'var(--gv-faint)', margin: 0 }}>{t('Connect a domain first.')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stats.map((s) => (
                    <div key={s.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--gv-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.hostname}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: s.delivered ? '#d9ff8f' : 'var(--gv-dim)' }}>
                          {s.delivered} / {s.published}
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                        <div style={{ width: `${s.published ? Math.min(100, (s.delivered / s.published) * 100) : 0}%`, height: '100%', background: 'var(--gv-accent)' }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gv-fainter)', marginTop: 6, lineHeight: 1.5 }}>
                        {s.delivered
                          ? <>Last import {s.lastAt ? new Date(s.lastAt).toLocaleDateString() : '—'}{s.lastUrl ? <> · <span className="mono">{s.lastUrl.replace(/^https?:\/\//, '').slice(0, 34)}</span></> : null}</>
                          : t('Nothing imported yet.')}
                      </div>
                      {/* The one line that decides who gets the search credit. */}
                      <div style={{ fontSize: 11, color: s.canonical ? 'var(--gv-fainter)' : '#ffb054', marginTop: 5, lineHeight: 1.5 }}>
                        {s.canonical
                          ? `Canonical → ${s.canonical}`
                          : 'Canonical still points at grove’s mirror. Have the agent call set_canonical_base once your URLs are settled.'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <span style={{ display: 'flex', color: anyDelivered ? 'var(--gv-accent-ink)' : '#ffb054' }}><Icon name={anyDelivered ? 'check' : 'alert'} size={15} /></span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t('Keep the beacon')}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.55, margin: 0 }}>
                Once your site renders the articles, grove stops seeing readers unless the page fires the analytics
                beacon. Reads, engagement and next month&rsquo;s topic plan all run on it — the agent gets the snippet
                from <span className="mono">integration_guide</span>, and it&rsquo;s first-party only: no cookies, no
                third-party JS.
              </p>
            </div>

            <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t('Which one do I want?')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>
                <div>— <span style={{ color: 'var(--gv-soft)' }}>{t('No blog yet?')}</span> {t('Use Embed. One snippet, zero code, grove renders everything.')}</div>
                <div>— <span style={{ color: 'var(--gv-soft)' }}>{t('Blog you like, want the posts inside it?')}</span> {t('This page.')}</div>
                <div>— Both work at once — the articles are the same articles.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
