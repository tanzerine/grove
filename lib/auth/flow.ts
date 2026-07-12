/**
 * Pure decision helpers for the unified "sign in or create" auth flow.
 *
 * There is a single auth surface — no separate signup. On email submit the
 * component tries to sign in; if that fails because the credentials don't match
 * an existing session, it attempts to create the account. Supabase deliberately
 * won't tell you *why* sign-in failed (to avoid leaking which emails exist), so
 * the create attempt is what disambiguates "no account yet" from "wrong
 * password on an existing account".
 *
 * These functions hold that branching so it can be unit-tested without a live
 * auth backend; the component just calls Supabase and feeds results in here.
 */

export type SignInDecision =
  | { step: 'signed-in' }
  | { step: 'try-create' }
  | { step: 'error'; message: string };

/** Interpret a signInWithPassword outcome. `null` error = a real session. */
export function afterSignIn(error: { message: string } | null): SignInDecision {
  if (!error) return { step: 'signed-in' };
  // Bad credentials is the one case where creating the account is the right
  // next move — the email may simply not exist yet. Any other error (rate
  // limit, network, disabled provider) is surfaced verbatim.
  if (isInvalidCredentials(error.message)) return { step: 'try-create' };
  return { step: 'error', message: friendlyAuthError(error.message) };
}

export type CreateDecision =
  | { step: 'onboard' }         // new account WITH a live session → go build the blog
  | { step: 'confirm-email' }   // created, but email confirmation is required first
  | { step: 'wrong-password' }  // email already registered → the sign-in password was wrong
  | { step: 'error'; message: string };

/** Interpret a signUp outcome that we only reach after sign-in failed. */
export function afterCreate(result: {
  hasSession: boolean;
  error: { message: string } | null;
}): CreateDecision {
  if (result.error) {
    // Reaching signUp means sign-in already failed for this email. If signUp
    // now says the user exists, the earlier failure was a wrong password.
    if (isAlreadyRegistered(result.error.message)) return { step: 'wrong-password' };
    return { step: 'error', message: friendlyAuthError(result.error.message) };
  }
  return result.hasSession ? { step: 'onboard' } : { step: 'confirm-email' };
}

export function isInvalidCredentials(message: string): boolean {
  return /invalid login credentials|invalid credentials|invalid email or password/i.test(message);
}

export function isAlreadyRegistered(message: string): boolean {
  return /already registered|already been registered|already exists|user already/i.test(message);
}

/** Map raw Supabase/GoTrue error text to something a person can act on. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (isInvalidCredentials(message)) return 'That email and password don’t match. Try again.';
  if (/password should be at least|password.*6|weak password|at least 8/i.test(message))
    return 'Password is too short — use at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a moment and try again.';
  if (/email.*invalid|invalid.*email|unable to validate email/i.test(m))
    return 'That doesn’t look like a valid email address.';
  return message;
}
