'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const STEPS = [
  'Verifying ownership…',
  'Provisioning your blog & SSL…',
  'Learning your brand voice…',
  'First post drafted & scheduled 🌱',
];

export default function PlantForm({ id = 'plant' }: { id?: string }) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [stepIdx, setStepIdx] = useState(-1);
  const [busy, setBusy] = useState(false);

  function clean(input: string) {
    return input.replace(/^https?:\/\//, '').replace(/\/$/, '').trim().toLowerCase();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const host = clean(domain);
    if (!host.includes('.')) return;
    setBusy(true);
    // animate the marketing steps, then send to signup with prefilled domain
    for (let i = 0; i < STEPS.length; i++) {
      setStepIdx(i);
      await new Promise((r) => setTimeout(r, 700));
    }
    router.push(`/signup?domain=${encodeURIComponent(host)}`);
  }

  return (
    <div className="domain-demo">
      <form className="domain-field" id={id} onSubmit={onSubmit} autoComplete="off">
        <span className="pre">https://</span>
        <input
          type="text"
          placeholder="yourdomain.com"
          aria-label="Your domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
          {busy ? 'Planting…' : 'Plant it'}
        </button>
      </form>
      <p className="demo-note">
        Free 14-day trial · <b>first post live in minutes</b> · no card required
      </p>
      <div className="plant-steps">
        {STEPS.map((label, i) => (
          <div key={i} className={`pstep ${i <= stepIdx ? 'on' : ''}`}>
            <span className="dot" />
            <span>
              {i === 0 && (
                <>
                  Verifying <span className="mono">{clean(domain) || 'yourdomain.com'}</span> ownership…
                </>
              )}
              {i > 0 && label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
