'use client';
export const dynamic = 'force-dynamic';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

function SignupInner() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const sp = useSearchParams();
  const prefillDomain = sp.get('domain') ?? '';
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await sb.auth.signUp({ email, password: pw });
    if (error) return setErr(error.message);
    router.replace(`/onboarding/domain?domain=${encodeURIComponent(prefillDomain)}`);
  }

  return (
    <main className="wrap" style={{ maxWidth: 420, padding: '80px 28px' }}>
      <h1 className="display" style={{ fontSize: 40 }}>Plant your domain</h1>
      <p className="lede" style={{ marginTop: 10 }}>Create your grove account. Your first post arrives in minutes.</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        <input className="domain-field" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 14 }} />
        <input className="domain-field" placeholder="Password (8+ chars)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ padding: 14 }} />
        {err && <p style={{ color: '#c33', fontSize: 13 }}>{err}</p>}
        <button className="btn btn-primary" type="submit">Continue →</button>
      </form>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignupInner />
    </Suspense>
  );
}
