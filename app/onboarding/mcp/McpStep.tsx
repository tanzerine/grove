'use client';
/**
 * The interactive half of the first-run MCP offer: mint one key, show it once,
 * hand over the command that uses it.
 *
 * The secret is returned by the API exactly once, so the snippets are rendered
 * next to the reveal with the real key already spliced in — a customer who has
 * to go and find it later can't, and the only recovery is minting a second
 * key. Before they create one the same snippets render with a placeholder, so
 * the ask is visible before a credential exists.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureClient } from '@/lib/analytics/capture-client';
import { KEY_PLACEHOLDER, installCommand, mcpJson } from '@/lib/mcp/install';
import { useT, tNodes } from '@/components/LocaleProvider';

const DIM = 'var(--gv-dim)';
const MONO = "'DM Mono', ui-monospace, monospace";

export default function McpStep({ endpoint, hostname }: { endpoint: string; hostname: string | null }) {
  const router = useRouter();
  const t = useT();
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'cli' | 'json'>('cli');

  const token = secret ?? KEY_PLACEHOLDER;

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/mcp/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Coding agent',
          // Deliberately not pinned to the domain being onboarded: the same
          // agent should still see site #2 when they add one, and /dashboard/mcp
          // is where a narrower key gets made if they ever want one.
          domain_id: null,
          scopes: ['read', 'write'],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API's `error` is sometimes a machine code ('unauthorized',
        // 'invalid') and sometimes a sentence written for a human ('Too many
        // active keys — revoke one first.'). Only the second kind helps here,
        // and a lone word like "forbidden" on a first-run screen reads as a
        // broken product. A space is a good enough test for which is which.
        const said = typeof body?.error === 'string' && body.error.includes(' ') ? body.error : null;
        setErr(said ?? t('Could not create the key — you can do this any time from Content API.'));
        return;
      }
      setSecret(body.secret);
      captureClient('mcp_key_created', { from: 'onboarding', write: true });
    } catch {
      setErr(t('Could not reach grove — you can do this any time from Content API.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="gv-onb-eyebrow">{t('Optional — for developers')}</span>
      <h1 className="gv-onb-title" style={{ fontSize: 'clamp(26px, 6.5vw, 36px)' }}>
        {hostname
          ? tNodes(t('Verified. Now — is {host}’s blog in a repo?'), {
              host: <span style={{ fontFamily: MONO, color: 'var(--gv-accent-ink)' }}>{hostname}</span>,
            })
          : t('Is your blog in a repo?')}
      </h1>
      <p className="gv-onb-lede">
        {t('If you already have a content layer — MDX in a repo, a CMS, your own pipeline — grove can hand finished articles straight to your coding agent over MCP, into the blog you already run. No embed script, no second blog beside the first. It’s one command, and it’s easiest now, while that repo is open.')}
      </p>

      <div className="gv-onb-card" style={{ marginTop: 26, padding: '22px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gv-ink)' }}>{t('1 · Make a key')}</div>
        <p style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6, margin: '6px 0 0' }}>
          {t('Read + write, every site on your account. Shown once, then stored only as a hash — grove can’t show it to you again.')}
        </p>

        {!secret ? (
          <>
            <button className="gv-onb-btn" onClick={create} disabled={busy} style={{ marginTop: 16, fontSize: 14, padding: '10px 18px' }}>
              {busy ? t('Creating…') : t('Create my key')}
            </button>
            {err && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--gv-red-text)' }}>{err}</p>}
          </>
        ) : (
          <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(162,255,1,0.07)', border: '1px solid rgba(162,255,1,0.32)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#d9ff8f' }}>{t('Copy it now — this is the only time it’s shown')}</span>
              <Copy text={secret} />
            </div>
            <code style={{ display: 'block', fontSize: 12, color: 'var(--gv-soft)', fontFamily: MONO, wordBreak: 'break-all' }}>{secret}</code>
          </div>
        )}
      </div>

      <div className="gv-onb-card" style={{ marginTop: 14, padding: '22px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gv-ink)' }}>{t('2 · Point your agent at grove')}</div>
        <p style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6, margin: '6px 0 14px' }}>
          {tNodes(
            secret
              ? t('Run it in the repository that holds your blog. Then ask it to {ask}.')
              : t('Run it in the repository that holds your blog — the key below is a placeholder until you make one. Then ask it to {ask}.'),
            { ask: <span style={{ color: 'var(--gv-soft)' }}>&ldquo;{t('import the new grove articles')}&rdquo;</span> },
          )}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`gv-onb-tab ${tab === 'cli' ? 'on' : ''}`} onClick={() => setTab('cli')}>Claude Code</button>
          <button className={`gv-onb-tab ${tab === 'json' ? 'on' : ''}`} onClick={() => setTab('json')}>Cursor / Claude Desktop</button>
        </div>

        <Snippet body={tab === 'cli' ? installCommand(endpoint, token) : mcpJson(endpoint, token)} />

        <p style={{ fontSize: 12.5, color: 'var(--gv-fainter)', lineHeight: 1.6, margin: '12px 0 0' }}>
          {tNodes(
            t('The agent gets the rest from grove itself — ask it for the {tool}, which covers the analytics beacon your pages need to keep and where grove should point its canonical URLs once yours are live.'),
            { tool: <span style={{ fontFamily: MONO }}>integration_guide</span> },
          )}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, flexWrap: 'wrap' }}>
        {/* Only ever one accent button on screen: before a key exists the page's
            point is the key, so leaving is the quiet option; afterwards the step
            is finished and leaving is the obvious one. */}
        <button className={secret ? 'gv-onb-btn' : 'gv-onb-ghost'} onClick={() => router.replace('/dashboard')}>
          {secret ? t('Done — open my dashboard →') : t('Skip for now →')}
        </button>
        {!secret && (
          <span style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6 }}>
            {tNodes(t('No repo? That’s fine — {embed} is one snippet and needs no code.'), {
              embed: <a href="/dashboard/embed" style={{ color: 'var(--gv-accent-ink)' }}>{t('the embed')}</a>,
            })}
          </span>
        )}
      </div>

      <p style={{ marginTop: 22, fontSize: 13, color: DIM, lineHeight: 1.6 }}>
        {tNodes(
          secret
            ? t('Manage this key any time from {link} — revoke it, scope one to a single site, and see what your layer has actually taken.')
            : t('You can set this up any time from {link} — it’s the same key, plus per-site scoping and what your layer has actually taken.'),
          { link: <a href="/dashboard/mcp" style={{ color: 'var(--gv-accent-ink)' }}>{t('Content API')}</a> },
        )}
      </p>
    </>
  );
}

function Snippet({ body }: { body: string }) {
  return (
    <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Copy text={body} />
      </div>
      <pre style={{ margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--gv-soft)', fontFamily: MONO, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#0d0e0b' }}>{body}</pre>
    </div>
  );
}

/**
 * Local rather than the dashboard's CopySnippet: onboarding is a self-contained
 * visual world (its own classes, no dashboard chrome), and the whole page is
 * worthless if the copy silently no-ops — hence the execCommand fallback the
 * dashboard button also carries.
 */
function Copy({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button onClick={copy} style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}>
      {copied ? t('Copied') : t('Copy')}
    </button>
  );
}
