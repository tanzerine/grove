'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Icon from '../gv-icons';

export default function CrawlButton({ domainId, hostname }: { domainId: string; hostname: string }) {
  const r = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function crawl() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/domains/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: domainId }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
      } else {
        r.refresh();
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button className="gv-btn" onClick={crawl} disabled={busy}
        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '10px 16px', borderRadius: 9, cursor: 'pointer', opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap' }}>
        <Icon name="refresh" size={14} />{busy ? `Crawling ${hostname}…` : 'Crawl my site'}
      </button>
      {err && (
        <div style={{ background: 'rgba(201,79,79,0.08)', border: '1px solid rgba(201,79,79,0.3)', color: 'var(--gv-red-text)', padding: '8px 12px', borderRadius: 8, fontSize: 12, maxWidth: 460, textAlign: 'right' }}>
          {err}
        </div>
      )}
    </div>
  );
}
