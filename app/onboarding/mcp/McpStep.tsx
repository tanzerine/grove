'use client';
/**
 * The interactive half of the first-run MCP offer: one link, approved in the
 * browser.
 *
 * Nothing is minted here. The endpoint's 401 names grove's OAuth server, so the
 * customer's agent registers itself and opens grove's consent screen the first
 * time it connects — the whole setup is "paste this, click Allow". An earlier
 * version minted a key on this screen and spliced it into the command, which
 * made a first-run offer into a secret to copy, store and never lose. Keys
 * still exist on /dashboard/mcp for agents with no browser.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { installCommand, mcpJson } from '@/lib/mcp/install';
import { useT, tNodes } from '@/components/LocaleProvider';

const DIM = 'var(--gv-dim)';
const MONO = "'DM Mono', ui-monospace, monospace";

type Tab = 'cli' | 'json' | 'url';

export default function McpStep({ endpoint, hostname }: { endpoint: string; hostname: string | null }) {
  const router = useRouter();
  const t = useT();
  const [tab, setTab] = useState<Tab>('cli');

  const body = tab === 'cli' ? installCommand(endpoint) : tab === 'json' ? mcpJson(endpoint) : endpoint;
  const note =
    tab === 'cli'
      ? t('Run it in the repository that holds your blog, then run /mcp inside Claude Code and choose Authenticate.')
      : tab === 'json'
        ? t('Add it to your mcp.json. Your client shows a sign-in prompt the first time it connects.')
        : t('Settings → Connectors → Add custom connector, and paste the link.');

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
        {t('If you already have a content layer — MDX in a repo, a CMS, your own pipeline — grove can hand finished articles straight to your coding agent over MCP, into the blog you already run. No embed script, no second blog beside the first. It’s one link, and it’s easiest now, while that repo is open.')}
      </p>

      <div className="gv-onb-card" style={{ marginTop: 26, padding: '22px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gv-ink)' }}>{t('1 · Add grove to your agent')}</div>
        <p style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6, margin: '6px 0 14px' }}>{note}</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`gv-onb-tab ${tab === 'cli' ? 'on' : ''}`} onClick={() => setTab('cli')}>Claude Code</button>
          <button className={`gv-onb-tab ${tab === 'json' ? 'on' : ''}`} onClick={() => setTab('json')}>Cursor</button>
          <button className={`gv-onb-tab ${tab === 'url' ? 'on' : ''}`} onClick={() => setTab('url')}>Claude Desktop</button>
        </div>

        <Snippet body={body} />
      </div>

      <div className="gv-onb-card" style={{ marginTop: 14, padding: '22px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gv-ink)' }}>{t('2 · Approve it in your browser')}</div>
        <p style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6, margin: '6px 0 0' }}>
          {tNodes(t('The first time it connects, grove opens in your browser. Click Allow — there’s no key to copy. Then ask it to {ask}.'), {
            ask: <span style={{ color: 'var(--gv-soft)' }}>&ldquo;{t('import the new grove articles')}&rdquo;</span>,
          })}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--gv-fainter)', lineHeight: 1.6, margin: '12px 0 0' }}>
          {tNodes(
            t('The agent gets the rest from grove itself — ask it for the {tool}, which covers the analytics beacon your pages need to keep and where grove should point its canonical URLs once yours are live.'),
            { tool: <span style={{ fontFamily: MONO }}>integration_guide</span> },
          )}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, flexWrap: 'wrap' }}>
        <button className="gv-onb-btn" onClick={() => router.replace('/dashboard')}>
          {t('Continue to my dashboard →')}
        </button>
        <span style={{ fontSize: 13.5, color: DIM, lineHeight: 1.6 }}>
          {tNodes(t('No repo? That’s fine — {embed} is one snippet and needs no code.'), {
            embed: <a href="/dashboard/embed" style={{ color: 'var(--gv-accent-ink)' }}>{t('the embed')}</a>,
          })}
        </span>
      </div>

      <p style={{ marginTop: 22, fontSize: 13, color: DIM, lineHeight: 1.6 }}>
        {tNodes(t('Approved agents show up in {link}, where you can disconnect one and see what your layer has actually taken.'), {
          link: <a href="/dashboard/mcp" style={{ color: 'var(--gv-accent-ink)' }}>{t('Content API')}</a>,
        })}
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
