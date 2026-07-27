'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import GroveMark from '@/components/GroveMark';
import { afterSignIn, afterCreate } from '@/lib/auth/flow';
import { captureClient } from '@/lib/analytics/capture-client';

/**
 * One auth surface — no separate sign-up. The user enters an email + password
 * (or uses Google) and we figure out the rest: an existing account signs in, a
 * new one is created on the spot. New users land in onboarding via the
 * dashboard's domain gate; returning users go straight to their dashboard.
 */
export default function AuthForm() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const sp = useSearchParams();

  // A domain typed on the landing hero flows straight into onboarding; a plain
  // sign-in goes to the dashboard, which redirects new (domain-less) users into
  // onboarding on its own. An explicit ?next= (e.g. from the middleware gate)
  // always wins.
  const prefillDomain = sp.get('domain') ?? '';
  const explicitNext = sp.get('next');
  const next =
    explicitNext ??
    (prefillDomain ? `/onboarding/about?domain=${encodeURIComponent(prefillDomain)}` : '/dashboard');

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'google' | 'email'>(null);

  async function withGoogle() {
    setErr(null);
    setNotice(null);
    setBusy('google');
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) {
      setErr(error.message);
      setBusy(null);
    }
    // On success the browser is redirected to Google — no further work here.
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy('email');

    // 1. Try to sign in.
    const signIn = await sb.auth.signInWithPassword({ email, password: pw });
    const d1 = afterSignIn(signIn.error);
    if (d1.step === 'signed-in') {
      captureClient('signed_in', { method: 'email' });
      return router.replace(next);
    }
    if (d1.step === 'error') {
      setBusy(null);
      captureClient('sign_in_failed', { reason: 'other' });
      return setErr(d1.message);
    }

    // 2. Sign-in failed on bad credentials — the account may not exist yet, so
    //    attempt to create it. This is what makes the single surface work.
    const signUp = await sb.auth.signUp({ email, password: pw });
    const d2 = afterCreate({ hasSession: !!signUp.data.session, error: signUp.error });
    setBusy(null);
    switch (d2.step) {
      case 'onboard':
        captureClient('signed_up', { method: 'email', confirmation_required: false });
        return router.replace(next);
      case 'confirm-email':
        // The single most important number at launch: everyone who reaches
        // this branch has created an account but cannot use it until they
        // find a confirmation email. The gap between this and the next
        // `signed_in` is the signup funnel's real drop-off.
        captureClient('signed_up', { method: 'email', confirmation_required: true });
        return setNotice('Account created — check your email to confirm it, then come back and sign in.');
      case 'wrong-password':
        captureClient('sign_in_failed', { reason: 'wrong_password' });
        return setErr('That email already has an account, but the password is wrong. Try again, or reset it.');
      case 'error':
        captureClient('sign_in_failed', { reason: 'other' });
        return setErr(d2.message);
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

        <h1 className="gv-auth-title">Sign in to Grove</h1>
        <p className="gv-auth-sub">
          Enter your email to continue. New here? We’ll create your account automatically.
        </p>

        <button type="button" className="gv-auth-google" onClick={withGoogle} disabled={busy !== null}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
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
            placeholder="Password (8+ chars)"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />

          {err && <p className="gv-auth-err">{err}</p>}
          {notice && <p className="gv-auth-sub" style={{ marginTop: 4 }}>{notice}</p>}

          <button type="submit" className="gv-auth-submit" disabled={busy !== null}>
            {busy === 'email' ? '…' : 'Continue →'}
          </button>
        </form>

        <p className="gv-auth-switch">
          One sign-in for everything. No account yet? Just continue — we’ll set it up.
        </p>
      </div>
    </main>
  );
}
