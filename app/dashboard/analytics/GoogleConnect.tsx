'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCENT = 'var(--gv-accent)';

type SetupState =
  | { status: 'verified'; siteUrl: string }
  | { status: 'needs_dns'; host: string; record: string; property: string }
  | { status: 'dns_not_found' }
  | { status: 'disconnected' }
  | { status: 'error'; reason: string };

/** Google "G" mark — official four-colour glyph, sized for a button. */
function GoogleMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0 }} aria-hidden>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 002 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/**
 * The "Connect Google" control that lives in the Analytics top bar.
 * Wraps the real Search Console OAuth popup + verify/refresh endpoints so the
 * page can show live data — wraps the connect popup, the one-time DNS verify
 * step, and a manual refresh, all styled for the dark dashboard skin.
 */
export default function GoogleConnect({
  configured, connected, verified,
}: { configured: boolean; connected: boolean; verified: boolean }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'connect' | 'verify' | 'sync'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [copied, setCopied] = useState(false);
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
        : `Couldn’t connect (${d.error}).`);
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

  async function loadSetup() {
    setErr(null);
    const res = await fetch('/api/search-console/setup');
    const j: SetupState = await res.json().catch(() => ({ status: 'error', reason: 'fetch' }));
    if (j.status === 'verified') { r.refresh(); return; }
    setSetup(j);
  }

  function toggleSetup() {
    const next = !setupOpen;
    setSetupOpen(next);
    if (next && !setup) loadSetup();
  }

  async function verify() {
    setBusy('verify'); setErr(null);
    const res = await fetch('/api/search-console/verify', { method: 'POST' });
    const j: SetupState = await res.json().catch(() => ({ status: 'error', reason: 'verify' }));
    setBusy(null);
    if (j.status === 'verified') { r.refresh(); return; }
    setSetup(j);
    if (j.status === 'dns_not_found') {
      setErr('DNS record not visible yet — it can take up to an hour. Try again shortly.');
    }
  }

  async function sync() {
    setBusy('sync'); setErr(null);
    const res = await fetch('/api/search-console/sync', { method: 'POST' });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(`Refresh failed: ${j.error ?? 'unknown'}`); return; }
    r.refresh();
  }

  // Not set up on this instance — nothing the owner can do, so stay quiet.
  if (!configured) return null;

  const wrap = (node: React.ReactNode) => (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      {node}
      {err && (
        <span style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50, width: 240, fontSize: 11.5, lineHeight: 1.45, color: 'var(--gv-red-soft)', background: '#1a1110', border: '1px solid rgba(240,120,100,0.3)', borderRadius: 10, padding: '8px 11px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {err}
        </span>
      )}
    </span>
  );

  // 1) Verified → live, show a connected pill + refresh.
  if (connected && verified) {
    return wrap(
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 11px 7px 12px', border: '1px solid rgba(99,194,129,0.28)', background: 'rgba(99,194,129,0.08)', borderRadius: 999 }}>
        <GoogleMark size={14} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gv-soft)' }}>Google connected</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, animation: 'gvPulse 2.4s ease-in-out infinite' }} />
        <button onClick={sync} disabled={busy === 'sync'} className="gv-ghost" style={{ marginLeft: 2, border: 'none', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '2px 6px', borderRadius: 7, cursor: 'pointer' }}>
          {busy === 'sync' ? 'Syncing…' : 'Refresh'}
        </button>
      </span>,
    );
  }

  // 2) Connected but the property still needs the one DNS step.
  if (connected && !verified) {
    const rec = setup?.status === 'needs_dns' ? setup.record : '';
    const host = setup?.status === 'needs_dns' ? setup.host : '';
    return (
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button onClick={toggleSetup} className="gv-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: '1px solid rgba(212,165,90,0.4)', background: 'rgba(212,165,90,0.1)', color: 'var(--gv-amber)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}>
          <GoogleMark size={14} />
          Finish Google setup
          <span style={{ color: '#b89a5a', fontSize: 11, transform: setupOpen ? 'rotate(180deg)' : 'none', transition: '.2s' }}>⌄</span>
        </button>
        {setupOpen && (
          <div style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 60, width: 320, background: '#12150f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 16, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            {!setup ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--gv-dim)' }}>Checking your Search Console…</p>
            ) : setup.status === 'needs_dns' ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gv-ink)' }}>One step left</div>
                <p style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5, margin: '6px 0 12px' }}>
                  Add this <b style={{ color: 'var(--gv-soft)' }}>TXT record</b> to <b style={{ color: 'var(--gv-soft)' }}>{host}</b>&apos;s DNS, then verify — Grove adds the Search Console property for you.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 12px' }}>
                  <Field label="Type" value="TXT" />
                  <Field label="Name" value="@" />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ width: 44, flexShrink: 0, color: 'var(--gv-faint)' }}>Value</span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--gv-soft)', fontFamily: 'monospace', fontSize: 11.5, overflowWrap: 'anywhere' }}>{rec}</span>
                    <button onClick={() => { navigator.clipboard?.writeText(rec); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="gv-ghost" style={{ flexShrink: 0, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 7, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <button onClick={verify} disabled={busy === 'verify'} className="gv-btn" style={{ border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 9, cursor: 'pointer' }}>
                    {busy === 'verify' ? 'Verifying…' : 'I’ve added it — verify'}
                  </button>
                  <span style={{ fontSize: 10.5, color: 'var(--gv-faint)' }}>DNS can take up to an hour.</span>
                </div>
              </>
            ) : setup.status === 'dns_not_found' ? (
              <>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--gv-amber)', lineHeight: 1.5 }}>We can&apos;t see the record yet — DNS changes can take up to an hour. Double-check the value, then verify again.</p>
                <button onClick={loadSetup} className="gv-ghost" style={{ marginTop: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer' }}>Show the record again</button>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--gv-red-soft)', lineHeight: 1.5 }}>Something went wrong reaching Search Console. Try disconnecting and connecting again.</p>
            )}
          </div>
        )}
        {err && (
          <span style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50, width: 240, fontSize: 11.5, lineHeight: 1.45, color: 'var(--gv-red-soft)', background: '#1a1110', border: '1px solid rgba(240,120,100,0.3)', borderRadius: 10, padding: '8px 11px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>{err}</span>
        )}
      </span>
    );
  }

  // 3) Not connected → the connect CTA.
  return wrap(
    <button onClick={connect} disabled={busy === 'connect'} className="gv-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: '1px solid rgba(255,255,255,0.14)', background: '#fff', color: '#1f2421', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '8px 15px', borderRadius: 10, cursor: 'pointer' }}>
      <GoogleMark size={15} />
      {busy === 'connect' ? 'Connecting…' : 'Connect Google'}
    </button>,
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 44, flexShrink: 0, color: 'var(--gv-faint)' }}>{label}</span>
      <span style={{ color: 'var(--gv-soft)', fontFamily: 'monospace', fontSize: 11.5 }}>{value}</span>
    </div>
  );
}
