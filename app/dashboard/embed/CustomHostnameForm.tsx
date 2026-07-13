'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sets domains.custom_blog_hostname and then WATCHES the setup complete:
 * after save the form polls /api/domains/hostname-status, whose three probes
 * (Vercel attach, DNS record, HTTPS serving) render as a live checklist. The
 * customer types one hostname, copies one DNS record, and sees it go green —
 * no instruction paragraphs to follow blind.
 */

type Step = { id: 'attach' | 'dns' | 'live'; ok: boolean; label: string; hint?: string };
type Status = {
  configured: boolean;
  hostname?: string;
  record?: { type: string; host: string; value: string };
  steps?: Step[];
  allOk?: boolean;
};

const POLL_MS = 5000;
const MAX_POLLS = 24; // ~2 minutes, then fall back to the manual re-check button

export default function CustomHostnameForm({
  domainId, initial, hostname,
}: { domainId: string; initial: string | null; hostname: string }) {
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polls = useRef(0);
  const apex = hostname.replace(/^www\./, '');

  const check = useCallback(async (): Promise<Status | null> => {
    const res = await fetch(`/api/domains/hostname-status?domain_id=${domainId}`).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as Status | null;
    if (body) setStatus(body);
    return body;
  }, [domainId]);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    polls.current = 0;
    setPolling(true);
    const tick = async () => {
      polls.current += 1;
      const s = await check();
      if (s?.allOk || !s?.configured || polls.current >= MAX_POLLS) {
        stopPolling();
        return;
      }
      timer.current = setTimeout(tick, POLL_MS);
    };
    void tick();
  }, [check, stopPolling]);

  // A hostname saved in an earlier session should show its live status on
  // arrival, not a stale instruction block.
  useEffect(() => {
    if (initial) startPolling();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setState('saving');
    setError('');
    stopPolling();
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, custom_blog_hostname: value.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
      if (value.trim()) startPolling();
      else setStatus(null); // cleared — back to the grove-hosted URLs
    } else {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? 'could not save — try again');
      setState('error');
    }
  }

  function copyRecord() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(status?.record?.value ?? 'cname.vercel-dns.com').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  const configured = status?.configured && status.steps;

  // The field's grey placeholder ("blog.acme.com") reads as pre-filled, so an
  // empty Save used to silently clear the setting and still flash "Saved ✓".
  // Two guards: an empty field with nothing saved yet can't be submitted
  // (button disabled + "Save" is greyed), and clearing an existing hostname is
  // an explicit, differently-labelled action.
  const trimmed = value.trim();
  const isEmpty = trimmed === '';
  const isClear = isEmpty && !!initial;                 // remove a saved host
  const cannotSubmit = isEmpty && !initial;             // nothing to do
  const saveDisabled = state === 'saving' || cannotSubmit;
  const saveLabel =
    state === 'saving' ? 'Saving…'
    : state === 'saved' ? 'Saved ✓'
    : isClear ? 'Remove'
    : 'Save';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !saveDisabled) save(); }}
          placeholder={`blog.${apex}`}
          spellCheck={false}
          autoComplete="off"
          className="mono"
          style={{
            flex: '1 1 280px', fontSize: 13, padding: '9px 12px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--gv-ink)',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saveDisabled}
          title={cannotSubmit ? 'Enter a hostname first' : undefined}
          style={{
            padding: '9px 16px', borderRadius: 10,
            border: `1px solid ${isClear ? 'rgba(255,255,255,0.14)' : 'var(--gv-accent)'}`,
            background: isClear ? 'transparent' : 'var(--gv-accent)',
            color: isClear ? 'var(--gv-ink)' : 'var(--gv-on-accent)',
            fontSize: 13, cursor: saveDisabled ? 'not-allowed' : 'pointer',
            opacity: saveDisabled ? 0.5 : 1,
          }}
        >
          {saveLabel}
        </button>
      </div>
      {state === 'error' && (
        <p style={{ color: 'var(--gv-red)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
      )}
      {cannotSubmit && state !== 'error' && (
        <p style={{ color: 'var(--gv-dim)', fontSize: 12, margin: '6px 0 0' }}>
          Type a subdomain like <span className="mono">blog.{apex}</span> — the grey text is just an example.
        </p>
      )}

      {/* Live setup checklist — three real probes, polled until green. */}
      {configured && (
        <div style={{ margin: '12px 0 0', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--gv-line)', background: 'rgba(255,255,255,0.03)' }}>
          {status!.steps!.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0' }}>
              <span className="mono" aria-hidden style={{ fontSize: 13, color: s.ok ? 'var(--gv-accent)' : 'var(--gv-faint)' }}>
                {s.ok ? '✓' : '○'}
              </span>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13.5, color: s.ok ? 'var(--gv-ink)' : 'var(--gv-dim)' }}>{s.label}</span>
                {!s.ok && s.hint && (
                  <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5, marginTop: 2 }}>{s.hint}</div>
                )}
              </div>
            </div>
          ))}

          {status!.allOk ? (
            <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--gv-ink)' }}>
              Your blog is live at <a className="mono" style={{ color: 'var(--gv-accent)' }} href={`https://${status!.hostname}`} target="_blank" rel="noopener noreferrer">https://{status!.hostname}</a>.
              Canonical URLs, sitemap, RSS, robots.txt, and JSON-LD all point here — search credit lands on your domain.
            </p>
          ) : (
            <>
              {/* The one DNS record, copy-ready. Trailing-dot note because some
                  registrars require it and reject the bare value. */}
              <div style={{ margin: '10px 0 0', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--gv-line)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--gv-ink)' }}>
                  CNAME&nbsp;&nbsp;{status!.record?.host ?? 'blog'}&nbsp;→&nbsp;{status!.record?.value ?? 'cname.vercel-dns.com'}
                </span>
                <button
                  type="button"
                  onClick={copyRecord}
                  style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', fontSize: 12, cursor: 'pointer', color: 'var(--gv-ink)' }}
                >
                  {copied ? 'Copied ✓' : 'Copy value'}
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5 }}>
                If your registrar says the value must end with a dot, use{' '}
                <span className="mono">cname.vercel-dns.com.</span> — same record.
              </p>
              <div style={{ marginTop: 10 }}>
                {polling ? (
                  <span className="mono" style={{ fontSize: 12, color: 'var(--gv-dim)' }}>checking every few seconds…</span>
                ) : (
                  <button
                    type="button"
                    onClick={startPolling}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', fontSize: 12.5, cursor: 'pointer', color: 'var(--gv-ink)' }}
                  >
                    Check again
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!configured && (
        <p style={{ color: 'var(--gv-dim)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
          Save a hostname and grove connects it automatically — you&rsquo;ll get the one DNS record to add,
          and this card checks itself off as it goes live. Leave empty to keep the grove-hosted URLs.
        </p>
      )}
    </div>
  );
}
