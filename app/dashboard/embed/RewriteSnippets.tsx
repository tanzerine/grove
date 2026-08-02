'use client';
/**
 * Subfolder mode: the copy-paste proxy config that makes grove's blog serve
 * from a path on the customer's OWN domain (acme.com/blog/...). One config
 * block in their host, no code — and unlike the subdomain, the links those
 * articles earn compound into the apex domain they sell from.
 *
 * The snippets are generated (lib/rewrite-snippets) rather than written out per
 * platform so all four stay in agreement about the mount path and blog slug.
 */
import { useState } from 'react';
import CopySnippet from './CopySnippet';
import { rewriteSnippets, PROXIED_FILES, type RewriteTarget } from '@/lib/rewrite-snippets';

export default function RewriteSnippets({
  groveBase,
  blogSlug,
  hostname,
  path = '/blog',
}: {
  groveBase: string;
  blogSlug: string;
  hostname: string;
  path?: string;
}) {
  const targets: RewriteTarget[] = rewriteSnippets({ groveBase, blogSlug, hostname, path });
  const [key, setKey] = useState(targets[0].key);
  const active = targets.find((t) => t.key === key) ?? targets[0];

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
        Don&rsquo;t render articles yourself? Proxy ours instead
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 14px' }}>
        One config block in your host and <span className="mono">{hostname}{path}/&lt;slug&gt;</span> serves grove&rsquo;s
        pages from your own origin — same domain, so the SEO compounds into your apex instead of a subdomain.
        Set the canonical base above to <span className="mono">https://{hostname}{path}</span> so the URLs grove emits match.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {targets.map((t) => {
          const on = t.key === key;
          return (
            <button key={t.key} onClick={() => setKey(t.key)}
              style={{ border: `1px solid ${on ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'}`, background: on ? 'rgba(255,255,255,0.07)' : 'transparent', color: on ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', transition: '.2s' }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, color: 'var(--gv-faint)', fontFamily: "'SF Mono', ui-monospace, monospace" }}>{active.file}</span>
          <CopySnippet snippet={active.code} />
        </div>
        <pre style={{ margin: 0, padding: '14px 16px', fontSize: 11.5, lineHeight: 1.6, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0d0e0b' }}>{active.code}</pre>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--gv-fainter)', lineHeight: 1.55, margin: '10px 0 0' }}>
        The wildcard rule is what makes this work end to end — it carries{' '}
        {PROXIED_FILES.map((f) => <span key={f} className="mono">{path}/{f} </span>)}
        through as well, so search engines and answer engines can discover the blog, not just render it.
      </p>
    </div>
  );
}
