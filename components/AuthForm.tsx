'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import GroveMark from '@/components/GroveMark';

const REFERRAL_OPTIONS = [
  'Google / search',
  'X (Twitter)',
  'LinkedIn',
  'Reddit / community',
  'Friend or colleague',
  'Newsletter / blog',
  'YouTube / podcast',
  'Other',
];

// One Google button + one email/password card, shared by /login and /signup.
export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const sp = useSearchParams();
  const isSignup = mode === 'signup';
  const prefillDomain = sp.get('domain') ?? '';
  const next = sp.get('next') ?? (isSignup ? `/onboarding/domain?domain=${encodeURIComponent(prefillDomain)}` : '/dashboard');

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [referral, setReferral] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'google' | 'email'>(null);

  // Stash the referral answer so the Google OAuth round-trip can pick it up
  // in /auth/callback (where we finally know the authenticated user).
  function stashReferral() {
    if (isSignup && referral) {
      document.cookie = `grove_ref=${encodeURIComponent(referral)}; path=/; max-age=600; samesite=lax`;
    }
  }

  async function withGoogle() {
    setErr(null);
    setBusy('google');
    stashReferral();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      setErr(error.message);
      setBusy(null);
    }
    // On success the browser is redirected to Google — no further work here.
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy('email');
    if (isSignup) {
      const { error } = await sb.auth.signUp({
        email,
        password: pw,
        options: { data: referral ? { referral_source: referral } : undefined },
      });
      if (error) {
        setBusy(null);
        return setErr(error.message);
      }
      router.replace(next);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) {
        setBusy(null);
        return setErr(error.message);
      }
      router.replace(next);
    }
  }

  return (
    <main className="gv-auth">
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden>
        <span className="b1" />
        <span className="b2" />
      </div>

      <div className="gv-auth-card">
        <a href="/" className="gv-auth-brand">
          <svg className="gv-auth-mark" viewBox="0 0 32 32" aria-hidden>
            <use href="#grove-mark" />
          </svg>
          <span>grove<span className="dot">.</span></span>
        </a>

        <h1 className="gv-auth-title">{isSignup ? 'Plant your domain' : 'Welcome back'}</h1>
        <p className="gv-auth-sub">
          {isSignup
            ? 'Create your grove account. Your first post arrives in minutes.'
            : 'Sign in to your grove dashboard.'}
        </p>

        <button type="button" className="gv-auth-google" onClick={withGoogle} disabled={busy !== null}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          {busy === 'google' ? 'Connecting…' : `Continue with Google`}
        </button>

        <div className="gv-auth-or"><span>or</span></div>

        <form onSubmit={withEmail} className="gv-auth-fields">
          <input
            className="gv-auth-input"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="gv-auth-input"
            placeholder={isSignup ? 'Password (8+ chars)' : 'Password'}
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />

          {isSignup && (
            <label className="gv-auth-ref">
              <span>How did you hear about us? <em>(optional)</em></span>
              <select
                className="gv-auth-input gv-auth-select"
                value={referral}
                onChange={(e) => setReferral(e.target.value)}
              >
                <option value="">Select one…</option>
                {REFERRAL_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          )}

          {err && <p className="gv-auth-err">{err}</p>}

          <button type="submit" className="gv-auth-submit" disabled={busy !== null}>
            {busy === 'email' ? '…' : isSignup ? 'Create account →' : 'Sign in →'}
          </button>
        </form>

        <p className="gv-auth-switch">
          {isSignup ? (
            <>Already have an account? <a href="/login">Sign in →</a></>
          ) : (
            <>No account? <a href="/signup">Create one →</a></>
          )}
        </p>
      </div>
    </main>
  );
}
