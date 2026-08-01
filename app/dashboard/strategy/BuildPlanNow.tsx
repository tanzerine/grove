'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCENT = 'var(--gv-accent)';

/**
 * "Build this month's plan" — the way out of an empty strategy page.
 *
 * The interview builds a plan on the spot, so reaching this button means that
 * build didn't happen (a failed crawl, an LLM outage, an account from before the
 * auto-build). Waiting for the 1st of next month is not an acceptable answer to
 * that, and the strategist is a single call: let them ask for it.
 */
export default function BuildPlanNow({ domainId, label = 'Build this month’s plan →' }: { domainId: string; label?: string }) {
  const r = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function build() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/domains/${domainId}/strategy`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Show the reason when the server sends one. A friendly apology with
        // no cause is unactionable for the owner and undiagnosable for us —
        // the failure that motivated this was invisible outside Vercel's logs.
        const why = j.note && j.note !== j.message ? ` (${j.note})` : '';
        setErr(`${j.message ?? j.error ?? 'Could not build the plan. Try again.'}${why}`);
        return;
      }
      r.refresh();
    } catch {
      setErr('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={build} disabled={busy} className="gv-btn"
        style={{ display: 'inline-block', marginTop: 16, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '10px 18px', borderRadius: 10, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Planning your month…' : label}
      </button>
      <div style={{ fontSize: 11.5, color: busy ? 'var(--gv-dim)' : 'transparent', marginTop: 8 }}>
        The strategist is reading your site and your answers — about a minute.
      </div>
      {err && <p style={{ fontSize: 12.5, color: 'var(--gv-red)', margin: '4px 0 0' }}>{err}</p>}
    </div>
  );
}
