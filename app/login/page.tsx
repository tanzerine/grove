'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

function LoginInner() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) return setErr(error.message);
    router.replace(next);
  }

  return (
    <main className="wrap" style={{ maxWidth: 420, padding: '80px 28px' }}>
      <h1 className="display" style={{ fontSize: 40 }}>Sign in</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        <input className="domain-field" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 14 }} />
        <input className="domain-field" placeholder="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ padding: 14 }} />
        {err && <p style={{ color: '#c33', fontSize: 13 }}>{err}</p>}
        <button className="btn btn-primary" type="submit">Sign in</button>
        <a href="/signup" style={{ fontSize: 13, color: 'var(--clay)' }}>No account? Create one →</a>
      </form>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
