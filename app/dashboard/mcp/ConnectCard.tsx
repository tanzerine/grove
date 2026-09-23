'use client';
/**
 * Step 1 on /dashboard/mcp: the one link that connects an agent.
 *
 * No key is minted here and none is pasted. The endpoint's 401 names grove's
 * OAuth server, so the client registers itself, opens a browser on the consent
 * screen, and keeps the token it gets back — the customer's whole job is
 * "paste the link, click Allow". Keys still exist, one section down, for the
 * agent that has no browser to open.
 */
import CopySnippet from '../embed/CopySnippet';
import { useT } from '../i18n';
import { installCommand, mcpJson } from '@/lib/mcp/install';
import { Snippet } from './KeyManager';

const MONO = "'SF Mono', ui-monospace, monospace";

export default function ConnectCard({ endpoint }: { endpoint: string }) {
  const t = useT();
  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>{t('Step 1 · Connect your agent')}</div>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>{t('Paste one link, approve it in your browser')}</div>
      <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 620 }}>
        {t('No key to make. Add grove to your agent with this link. The first time it connects, grove opens in your browser — click Allow and you’re done.')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(162,255,1,0.07)', border: '1px solid rgba(162,255,1,0.32)' }}>
        <code style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--gv-soft)', fontFamily: MONO, overflowWrap: 'anywhere' }}>{endpoint}</code>
        <CopySnippet snippet={endpoint} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--gv-fainter)', lineHeight: 1.55, margin: '8px 0 18px' }}>
        {t('Claude Desktop or claude.ai: Settings → Connectors → Add custom connector, and paste the link.')}
      </p>

      <Snippet label={t('Claude Code — then run /mcp and choose Authenticate')} body={installCommand(endpoint)} />
      <div style={{ height: 12 }} />
      <Snippet label={t('Cursor and other clients — mcp.json')} body={mcpJson(endpoint)} />

      <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '16px 0 0' }}>
        {t('Then ask it to “import the new grove articles”.')}
      </p>
    </div>
  );
}
