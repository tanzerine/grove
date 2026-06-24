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

type SetupState =
  | { status: 'verified'; siteUrl: string }
  | { status: 'needs_dns'; host: string; record: string; property: string }
  | { status: 'dns_not_found' }
  | { status: 'disconnected' }
  | { status: 'error'; reason: string };

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const path = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

export default function SearchConsolePanel({
  configured, connected, verified, data, syncedAt,
}: { configured: boolean; connected: boolean; verified: boolean; data: Visibility | null; syncedAt: string | null }) {
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
      else setErr(d.error === 'not_configured'
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

  // 1) Not connected → the connect CTA.
  if (!connected) {
    return (
      <section style={card}>
        <div className="mono" style={kicker}>SEARCH VISIBILITY</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--clay)', margin: 0, maxWidth: 520, lineHeight: 1.55 }}>
            See what you&apos;re actually showing up for on Google. Grove sets up Search Console for
            you — connect your Google account and it handles the rest (one quick DNS step if your
            site isn&apos;t in Search Console yet).
          </p>
          <button onClick={connect} disabled={busy === 'connect'} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
            {busy === 'connect' ? 'Connecting…' : 'Connect Google'}
          </button>
        </div>
        {err && <p style={{ fontSize: 12.5, color: '#b04a3b', marginTop: 10 }}>{err}</p>}
      </section>
    );
  }

  // 2) Connected but no property yet → the one-DNS-record setup step.
  if (!verified) return <SetupCard onDisconnect={disconnect} disconnecting={busy === 'disconnect'} />;

  // 3) Verified → the live data.
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

/* ── connected, but the property still needs one DNS TXT record ────────────── */
function SetupCard({ onDisconnect, disconnecting }: { onDisconnect: () => void; disconnecting: boolean }) {
  const r = useRouter();
  const [state, setState] = useState<SetupState | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch('/api/search-console/setup');
    const j: SetupState = await res.json().catch(() => ({ status: 'error', reason: 'fetch' }));
    if (j.status === 'verified') { r.refresh(); return; }
    setState(j);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function verify() {
    setVerifying(true);
    const res = await fetch('/api/search-console/verify', { method: 'POST' });
    const j: SetupState = await res.json().catch(() => ({ status: 'error', reason: 'verify' }));
    setVerifying(false);
    if (j.status === 'verified') { r.refresh(); return; }
    setState(j);
  }

  const record = state?.status === 'needs_dns' ? state.record : '';

  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="mono" style={kicker}>SEARCH VISIBILITY · FINISH SETUP</div>
        <button onClick={onDisconnect} disabled={disconnecting} style={linkBtn}>Disconnect</button>
      </div>

      {!state ? (
        <p style={{ fontSize: 14, color: 'var(--clay)', margin: '14px 0 0' }}>Checking your Search Console…</p>
      ) : state.status === 'needs_dns' ? (
        <>
          <p style={{ fontSize: 14, color: 'var(--ink)', margin: '12px 0 4px', lineHeight: 1.55 }}>
            One step left. Add this <b>TXT record</b> to <b>{state.host}</b>&apos;s DNS, then click verify —
            Grove adds the Search Console property for you. (Adding it alongside your Grove domain
            check means one trip to your DNS provider.)
          </p>
          <div style={dnsBox}>
            <Row label="Type" value="TXT" />
            <Row label="Name / Host" value="@" sub="(the domain root)" />
            <Row label="Value" value={record} mono copyable onCopy={() => { navigator.clipboard?.writeText(record); setCopied(true); setTimeout(() => setCopied(false), 1500); }} copied={copied} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={verify} disabled={verifying} className="btn btn-primary btn-sm">
              {verifying ? 'Verifying…' : 'I’ve added it — verify'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--clay)' }}>DNS can take a few minutes to an hour to propagate.</span>
          </div>
        </>
      ) : state.status === 'dns_not_found' ? (
        <>
          <p style={{ fontSize: 14, color: '#b07a16', margin: '12px 0 0', lineHeight: 1.55 }}>
            We can&apos;t see the record yet — DNS changes can take up to an hour. Double-check the TXT
            value is exact, then try again.
          </p>
          <button onClick={load} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>Show the record again</button>
        </>
      ) : (
        <p style={{ fontSize: 14, color: '#b04a3b', margin: '12px 0 0' }}>
          Something went wrong reaching Search Console. Try disconnecting and connecting again.
        </p>
      )}
    </section>
  );
}

function Row({ label, value, sub, mono, copyable, onCopy, copied }: {
  label: string; value: string; sub?: string; mono?: boolean; copyable?: boolean; onCopy?: () => void; copied?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 12, color: 'var(--clay)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', fontFamily: mono ? 'DM Mono, monospace' : 'inherit', overflowWrap: 'anywhere' }}>
        {value || '—'} {sub && <span style={{ color: 'var(--clay)' }}>{sub}</span>}
      </span>
      {copyable && (
        <button onClick={onCopy} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>{copied ? 'Copied' : 'Copy'}</button>
      )}
    </div>
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
const dnsBox: React.CSSProperties = {
  marginTop: 12, padding: '4px 16px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12,
};
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
