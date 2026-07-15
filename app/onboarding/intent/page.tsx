'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INTERVIEW, type InterviewAnswers } from '@/lib/strategy/interview';
import GroveMark from '@/components/GroveMark';

const DIM = 'var(--gv-dim)';

export default function IntentPage() {
  const router = useRouter();
  const [domainId, setDomainId] = useState<string | null>(null);
  const [hostname, setHostname] = useState<string>('');
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetch the verified domain we're configuring intent for.
  useEffect(() => {
    fetch('/api/domains/me').then(async (r) => {
      if (!r.ok) return router.replace('/onboarding/domain');
      const j = await r.json();
      const d = j?.domain;
      if (!d?.id) return router.replace('/onboarding/domain');
      setDomainId(d.id);
      setHostname(d.hostname ?? '');
      setAnswers(d.interview ?? {});
    });
  }, [router]);

  function setAns(id: string, value: string | string[]) {
    setAnswers((cur) => ({ ...cur, [id]: value }));
  }

  function toggleMulti(id: string, option: string, max = 2) {
    setAnswers((cur) => {
      const list = Array.isArray(cur[id]) ? (cur[id] as string[]) : [];
      const next = list.includes(option) ? list.filter((x) => x !== option) : [...list, option].slice(-max);
      return { ...cur, [id]: next };
    });
  }

  async function submit(skip = false) {
    if (!domainId) return;
    setBusy(true);
    setErr(null);
    const body = skip ? {} : answers;
    const res = await fetch(`/api/domains/${domainId}/interview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: body, skip }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j?.error ?? 'Failed to save');
      return;
    }
    router.replace('/dashboard/strategy');
  }

  return (
    <main className="gv-onb">
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden><span className="b1" /><span className="b2" /></div>
      <div className="gv-onb-in" style={{ maxWidth: 720 }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.1em', color: DIM }}>
          STEP 5 OF 6 — INTENT
        </div>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(27px, 6.5vw, 38px)' }}>
          A few questions for {hostname || 'your blog'}.
        </h1>
        <p className="gv-onb-lede">
          The strategist agent uses these to plan each month. All optional — skip what&apos;s not clear yet.
        </p>

        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {INTERVIEW.map((q) => (
            <section key={q.id} className="gv-onb-card" style={{ padding: '22px 24px' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gv-ink)' }}>{q.prompt}</div>
              {q.help && <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>{q.help}</div>}

              {q.kind === 'single' && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {q.options!.map((opt) => {
                    const selected = answers[q.id] === opt;
                    return (
                      <label key={opt} style={radioRow(selected)}>
                        <input type="radio" name={q.id} checked={selected} onChange={() => setAns(q.id, opt)}
                          style={{ marginRight: 10, accentColor: 'var(--gv-accent)' }} />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}

              {q.kind === 'multi' && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {q.options!.map((opt) => {
                    const list = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                    const selected = list.includes(opt);
                    return (
                      <label key={opt} style={radioRow(selected)}>
                        <input type="checkbox" checked={selected} onChange={() => toggleMulti(q.id, opt, 2)}
                          style={{ marginRight: 10, accentColor: 'var(--gv-accent)' }} />
                        {opt}
                      </label>
                    );
                  })}
                  <div style={{ fontSize: 11, color: DIM }}>Pick up to 2.</div>
                </div>
              )}

              {q.kind === 'text' && (
                <textarea className="gv-onb-input" value={(answers[q.id] as string) ?? ''}
                  onChange={(e) => setAns(q.id, e.target.value)} placeholder="Type a sentence or two…" rows={3}
                  style={{ marginTop: 14, resize: 'vertical' }} />
              )}
            </section>
          ))}
        </div>

        {err && <div style={{ marginTop: 20, color: 'var(--gv-red-text)', fontSize: 14 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 30 }}>
          <button onClick={() => submit(true)} disabled={busy} className="gv-onb-ghost">Skip for now</button>
          <button onClick={() => submit(false)} disabled={busy} className="gv-onb-btn">
            {busy ? 'Saving…' : 'Save and continue →'}
          </button>
        </div>
      </div>
    </main>
  );
}

function radioRow(selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    border: `1px solid ${selected ? 'rgba(99,194,129,0.5)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 10,
    background: selected ? 'rgba(99,194,129,0.1)' : 'rgba(255,255,255,0.02)',
    cursor: 'pointer',
    fontSize: 15,
    color: selected ? 'var(--gv-ink)' : 'var(--gv-soft)',
  };
}
