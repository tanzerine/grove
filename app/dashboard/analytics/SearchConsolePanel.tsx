'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export type Visibility = {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number;
  queryCount: number;
  topQueries: { query: string; impressions: number; clicks: number; position: number }[];
  nearWinners: { key: string; post_id: string | null; impressions: number; clicks: number; position: number }[];
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const path = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

export default function SearchConsolePanel({
  configured, connected, data, syncedAt,
}: { configured: boolean; connected: boolean; data: Visibility | null; syncedAt: string | null }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);
  const [err, setErr] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.source !== 'grove-oauth' || d.platform !== 'gsc') return;
      if (pollRef.current) clearInterval(pollRef.current);
      try { popupRef.current?.close(); } catch { /* noop */ }
      setBusy(null);
      if (d.ok) r.refresh();
      else setErr(d.error === 'no_matching_property'
        ? "We couldn't find this site in your Search Console. Add & verify it in GSC first."
        : d.error === 'not_configured'
          ? 'Search Console isn’t set up on this Grove instance yet.'
          : `Couldn't connect (${d.error}).`);
    }
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); if (pollRef.current) clearInterval(pollRef.current); };
  }, [r]);

  function connect() {
    setErr(null);
    const w = 560, h = 700;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open('/api/search-console/connect', 'grove_gsc', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) { window.location.href = '/api/search-console/connect'; return; }
    popupRef.current = popup;
    setBusy('connect');
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (popup.closed) { if (pollRef.current) clearInterval(pollRef.current); setBusy((c) => (c === 'connect' ? null : c)); }
    }, 600);
  }

  async function sync() {
    setBusy('sync'); setErr(null);
    const res = await fetch('/api/search-console/sync', { method: 'POST' });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(`Refresh failed: ${j.error ?? 'unknown'}`); return; }
    r.refresh();
  }

  async function disconnect() {
    if (!confirm('Disconnect Search Console? Grove keeps no copy of the token after this.')) return;
    setBusy('disconnect');
    await fetch('/api/search-console/disconnect', { method: 'POST' });
    setBusy(null);
    r.refresh();
  }

  // Not set up on this instance — nothing the owner can do, so stay quiet.
  if (!configured) return null;

  if (!connected) {
    return (
      <section style={card}>
        <div className="mono" style={kicker}>SEARCH VISIBILITY</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--clay)', margin: 0, maxWidth: 520, lineHeight: 1.55 }}>
            Connect Google Search Console to see what you&apos;re actually showing up for on Google —
            impressions and ranking position appear here <b>before</b> you get clicks, and Grove uses
            them to refresh the posts that are closest to page one.
          </p>
          <button onClick={connect} disabled={busy === 'connect'} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
            {busy === 'connect' ? 'Connecting…' : 'Connect Search Console'}
          </button>
        </div>
        {err && <p style={{ fontSize: 12.5, color: '#b04a3b', marginTop: 10 }}>{err}</p>}
      </section>
    );
  }

  const d = data;
  const hasData = !!d && d.impressions > 0;
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="mono" style={kicker}>SEARCH VISIBILITY · GOOGLE</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button onClick={sync} disabled={busy === 'sync'} className="btn btn-ghost btn-sm">
            {busy === 'sync' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={disconnect} disabled={busy === 'disconnect'} style={linkBtn}>Disconnect</button>
        </div>
      </div>

      {!hasData ? (
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '14px 0 0', lineHeight: 1.55 }}>
          Connected. Google hasn&apos;t reported impressions for this property yet — a brand-new site
          usually takes a couple of weeks to start appearing. Grove checks daily and will fill this in.
        </p>
      ) : (
        <>
          <div className="r-stats" style={{ marginTop: 16 }}>
            <Tile label="Impressions" value={fmt(d!.impressions)} hint="times you appeared in Google" />
            <Tile label="Clicks" value={fmt(d!.clicks)} />
            <Tile label="Avg position" value={d!.avgPosition ? d!.avgPosition.toFixed(1) : '—'} hint="1 = top of page 1" />
            <Tile label="Queries" value={fmt(d!.queryCount)} hint="searches you show up for" />
            <Tile label="CTR" value={`${(d!.ctr * 100).toFixed(1)}%`} />
          </div>

          {d!.nearWinners.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="mono" style={{ ...kicker, marginBottom: 4 }}>CLOSEST TO PAGE 1 · WORTH REFRESHING</div>
              <p style={{ fontSize: 12.5, color: 'var(--clay)', margin: '0 0 10px' }}>
                These already get impressions but sit on page 2. Refreshing one into the top 10 is the
                fastest way to win traffic — Grove also prioritizes them in next month&apos;s plan.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d!.nearWinners.map((w) => (
                  <div key={w.key} style={nwRow}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {path(w.key)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--clay)', whiteSpace: 'nowrap' }}>
                      {fmt(w.impressions)} impr · pos {w.position}
                    </span>
                    {w.post_id && (
                      <Link href={`/dashboard/posts/${w.post_id}`} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>
                        Refresh →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {d!.topQueries.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="mono" style={{ ...kicker, marginBottom: 8 }}>WHAT YOU RANK FOR</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {d!.topQueries.map((q) => (
                  <span key={q.query} style={queryChip} title={`${q.impressions} impressions · position ${q.position}`}>
                    {q.query} <span style={{ color: 'var(--clay)' }}>· {q.position}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {syncedAt && (
        <p style={{ fontSize: 11, color: 'var(--clay)', marginTop: 16 }}>Last updated {new Date(syncedAt).toLocaleDateString()}.</p>
      )}
      {err && <p style={{ fontSize: 12.5, color: '#b04a3b', marginTop: 10 }}>{err}</p>}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontFamily: 'Clash Display', fontSize: 24, color: 'var(--moss)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--clay)', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'white', border: '1px solid var(--line)', borderRadius: 18,
  boxShadow: 'var(--sh-md)', padding: '22px 24px', marginTop: 22,
};
const kicker: React.CSSProperties = { fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' };
const nwRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
  background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10,
};
const queryChip: React.CSSProperties = {
  fontSize: 12.5, padding: '4px 10px', borderRadius: 999,
  background: 'rgba(89,148,94,0.10)', color: 'var(--moss)', border: '1px solid rgba(89,148,94,0.25)',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--clay)', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline',
};
