'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const CONNECT_ERRORS: Record<string, string> = {
  not_configured: "That platform isn't set up yet — its API keys are missing from the environment.",
  cancelled: 'Connection cancelled.',
  state_mismatch: 'Connection expired or was tampered with. Try again.',
  session_expired: 'Your session expired. Refresh and try again.',
  no_domain: 'Connect a domain first.',
  connect_failed: "Couldn't connect — the platform rejected the request. Try again.",
};

export type PlatformView = {
  id: 'x' | 'linkedin' | 'instagram';
  configured: boolean;
  connection: { account_handle: string | null; connected_at: string } | null;
};

const META: Record<PlatformView['id'], { label: string; blurb: string; color: string }> = {
  x:         { label: 'X',         blurb: 'Auto-posts a hook + link when an article publishes.', color: '#000000' },
  linkedin:  { label: 'LinkedIn',  blurb: 'Shares the article as a LinkedIn post on your profile.', color: '#0A66C2' },
  instagram: { label: 'Instagram', blurb: 'Posts the cover image + caption (needs an IG Business account).', color: '#C13584' },
};

export default function ConnectionsClient({
  domainId, autoSocial, platforms, webhookUrl, webhookSecret,
}: {
  domainId: string; autoSocial: boolean; platforms: PlatformView[];
  webhookUrl: string | null; webhookSecret: string | null;
}) {
  const r = useRouter();
  const q = useSearchParams();
  const [auto, setAuto] = useState(autoSocial);
  const [busy, setBusy] = useState<string | null>(null);

  const [hook, setHook] = useState(webhookUrl ?? '');
  const [savingHook, setSavingHook] = useState(false);
  const [hookErr, setHookErr] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);

  const [connecting, setConnecting] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // OAuth popup: open the connect route in a centered window, then wait for the
  // callback page to postMessage the result back (or for the user to close it).
  function connect(pf: string) {
    setFlash(null);
    const w = 600, h = 760;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(
      `/api/social/${pf}/connect`, `grove_oauth_${pf}`,
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=yes`,
    );
    if (!popup) {
      // popup blocked — fall back to a full-page redirect
      window.location.href = `/api/social/${pf}/connect`;
      return;
    }
    popupRef.current = popup;
    setConnecting(pf);
    // If the user closes the window without finishing, clear the spinner.
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (popup.closed) {
        if (pollRef.current) clearInterval(pollRef.current);
        setConnecting((cur) => (cur === pf ? null : cur));
      }
    }, 600);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.source !== 'grove-oauth') return;
      if (pollRef.current) clearInterval(pollRef.current);
      try { popupRef.current?.close(); } catch { /* noop */ }
      setConnecting(null);
      if (d.ok) {
        setFlash({ ok: true, text: `Connected ${META[d.platform as PlatformView['id']]?.label ?? d.platform}.` });
        r.refresh();
      } else {
        setFlash({ ok: false, text: CONNECT_ERRORS[d.error] ?? `Couldn't connect (${d.error}).` });
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [r]);

  const connectedCount = platforms.filter((p) => p.connection).length;
  const webhookActive = !!webhookUrl;
  // Auto-share needs at least one outlet — a connected account OR the webhook.
  const outletCount = connectedCount + (webhookActive ? 1 : 0);
  const connectedMsg = q.get('connected');
  const errorMsg = q.get('error');

  async function toggleAuto() {
    if (outletCount === 0) return;
    const next = !auto;
    setAuto(next);
    await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, auto_social: next }),
    });
    r.refresh();
  }

  async function saveWebhook(url: string) {
    setSavingHook(true);
    setHookErr(null);
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, social_webhook_url: url }),
    });
    setSavingHook(false);
    if (!res.ok) {
      setHookErr(url ? 'Enter a valid https:// URL.' : 'Could not clear the webhook.');
      return;
    }
    r.refresh();
  }

  async function disconnect(pf: string) {
    setBusy(pf);
    await fetch(`/api/social/${pf}/disconnect`, { method: 'POST' });
    setBusy(null);
    r.refresh();
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h4 style={{ fontFamily: 'Inter', fontSize: 28, margin: 0 }}>Social accounts</h4>
        <p style={{ fontSize: 14, color: 'var(--clay)', marginTop: 6, maxWidth: 560 }}>
          Connect your accounts and Grove will automatically share each article when it publishes —
          using the channel-native copy it already writes for every post.
        </p>
      </div>

      {/* live popup result (preferred) */}
      {flash && <Banner ok={flash.ok}>{flash.text}</Banner>}
      {/* full-page-redirect fallback result, from URL params */}
      {!flash && connectedMsg && (
        <Banner ok>Connected {META[connectedMsg as PlatformView['id']]?.label ?? connectedMsg}.</Banner>
      )}
      {!flash && errorMsg && (
        <Banner>{CONNECT_ERRORS[errorMsg] ?? `Couldn't connect (${errorMsg}). Try again.`}</Banner>
      )}

      {/* auto-share toggle */}
      <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: 20, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Auto-share on publish</div>
          <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 2 }}>
            {outletCount === 0
              ? 'Connect an account or add a webhook below to enable.'
              : `When on, every published post is shared to your ${outletCount} ${outletCount === 1 ? 'outlet' : 'outlets'}${webhookActive ? ' (incl. webhook)' : ''}.`}
          </div>
        </div>
        <button
          onClick={toggleAuto}
          disabled={outletCount === 0}
          aria-pressed={auto}
          style={{
            width: 50, height: 28, borderRadius: 999, border: 'none', position: 'relative',
            cursor: outletCount === 0 ? 'not-allowed' : 'pointer',
            background: auto && outletCount > 0 ? 'var(--moss)' : 'var(--line)',
            transition: 'background .15s', opacity: outletCount === 0 ? 0.5 : 1,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: auto ? 25 : 3, width: 22, height: 22,
            borderRadius: '50%', background: 'white', transition: 'left .15s',
          }} />
        </button>
      </div>

      {/* platform cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {platforms.map((p) => {
          const m = META[p.id];
          return (
            <div key={p.id} style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: m.color, border: '1px solid rgba(255,255,255,0.14)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'Inter', flexShrink: 0 }}>
                {m.label[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 2 }}>
                  {p.connection
                    ? <>Connected{p.connection.account_handle ? ` as ${p.connection.account_handle}` : ''}.</>
                    : m.blurb}
                </div>
              </div>
              {!p.configured ? (
                <span style={{ fontSize: 12, color: 'var(--clay)', fontFamily: 'DM Mono' }}>not set up</span>
              ) : p.connection ? (
                <button onClick={() => disconnect(p.id)} disabled={busy === p.id} className="btn btn-ghost btn-sm">
                  {busy === p.id ? '…' : 'Disconnect'}
                </button>
              ) : (
                <button
                  onClick={() => connect(p.id)}
                  disabled={connecting === p.id}
                  className="btn btn-primary btn-sm"
                >
                  {connecting === p.id ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--clay)', marginTop: 16 }}>
        Tokens are encrypted at rest. Disconnect any time — Grove keeps no copy after that.
      </p>

      {/* webhook — the no-OAuth path: pipe every publish into Zapier / Make / n8n */}
      <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: 20, marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h4 style={{ fontFamily: 'Inter', fontSize: 20, margin: 0 }}>Publish webhook</h4>
          {webhookActive && (
            <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--moss)', background: 'rgba(89,148,94,0.10)', borderRadius: 999, padding: '2px 8px' }}>
              active
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--clay)', marginTop: 6, maxWidth: 560 }}>
          No app review, works today. Grove POSTs each published post — canonical URL,
          cover image, and ready-to-post copy for every channel — to your URL. Wire it into
          Zapier, Make, or n8n to fan out anywhere.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input
            type="url"
            inputMode="url"
            placeholder="https://hooks.zapier.com/…"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'DM Mono' }}
          />
          <button onClick={() => saveWebhook(hook.trim())} disabled={savingHook || hook.trim() === (webhookUrl ?? '')} className="btn btn-primary btn-sm">
            {savingHook ? '…' : 'Save'}
          </button>
          {webhookActive && (
            <button onClick={() => { setHook(''); saveWebhook(''); }} disabled={savingHook} className="btn btn-ghost btn-sm">
              Remove
            </button>
          )}
        </div>
        {hookErr && <div style={{ fontSize: 12, color: 'var(--gv-red)', marginTop: 8 }}>{hookErr}</div>}

        {webhookActive && webhookSecret && (
          <div style={{ marginTop: 14, fontSize: 13 }}>
            <div style={{ color: 'var(--clay)', marginBottom: 4 }}>
              Signing secret — verify the <code style={{ fontFamily: 'DM Mono' }}>x-grove-signature</code> header
              (<code style={{ fontFamily: 'DM Mono' }}>sha256=HMAC(secret, body)</code>):
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ fontFamily: 'DM Mono', fontSize: 12, background: 'var(--paper, #f6f5f2)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', userSelect: 'all' }}>
                {revealSecret ? webhookSecret : webhookSecret.slice(0, 9) + '•'.repeat(18)}
              </code>
              <button onClick={() => setRevealSecret((v) => !v)} className="btn btn-ghost btn-sm">
                {revealSecret ? 'Hide' : 'Reveal'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div style={{
      background: ok ? 'rgba(75,92,20,0.08)' : 'rgba(201,79,79,0.08)',
      border: `1px solid ${ok ? 'rgba(75,92,20,0.3)' : 'rgba(201,79,79,0.3)'}`,
      color: ok ? 'var(--moss)' : 'var(--gv-red-text)',
      borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16,
    }}>
      {children}
    </div>
  );
}
