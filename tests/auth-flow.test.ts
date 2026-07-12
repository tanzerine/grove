import { describe, it, expect } from 'vitest';
import {
  afterSignIn,
  afterCreate,
  isInvalidCredentials,
  isAlreadyRegistered,
  friendlyAuthError,
} from '../lib/auth/flow';

describe('afterSignIn', () => {
  it('treats a null error as a live session', () => {
    expect(afterSignIn(null)).toEqual({ step: 'signed-in' });
  });

  it('routes bad credentials to a create attempt (email may not exist yet)', () => {
    expect(afterSignIn({ message: 'Invalid login credentials' })).toEqual({ step: 'try-create' });
  });

  it('surfaces non-credential errors instead of blindly creating an account', () => {
    const d = afterSignIn({ message: 'Email logins are disabled' });
    expect(d.step).toBe('error');
  });
});

describe('afterCreate', () => {
  it('sends a genuinely new session into onboarding', () => {
    expect(afterCreate({ hasSession: true, error: null })).toEqual({ step: 'onboard' });
  });

  it('asks for email confirmation when signup returns no session', () => {
    expect(afterCreate({ hasSession: false, error: null })).toEqual({ step: 'confirm-email' });
  });

  it('reports a wrong password when the email is already registered', () => {
    // We only reach create after sign-in failed; "already registered" therefore
    // means the earlier sign-in used the wrong password.
    expect(afterCreate({ hasSession: false, error: { message: 'User already registered' } }))
      .toEqual({ step: 'wrong-password' });
  });

  it('surfaces other signup errors', () => {
    const d = afterCreate({ hasSession: false, error: { message: 'Signups not allowed' } });
    expect(d.step).toBe('error');
  });
});

describe('error classifiers', () => {
  it('matches Supabase invalid-credential phrasings', () => {
    expect(isInvalidCredentials('Invalid login credentials')).toBe(true);
    expect(isInvalidCredentials('Invalid email or password')).toBe(true);
    expect(isInvalidCredentials('Email rate limit exceeded')).toBe(false);
  });

  it('matches already-registered phrasings', () => {
    expect(isAlreadyRegistered('User already registered')).toBe(true);
    expect(isAlreadyRegistered('A user with this email address has already been registered')).toBe(true);
    expect(isAlreadyRegistered('Invalid login credentials')).toBe(false);
  });

  it('rewrites known errors and passes unknown ones through', () => {
    expect(friendlyAuthError('Invalid login credentials')).toMatch(/don’t match/);
    expect(friendlyAuthError('Password should be at least 8 characters')).toMatch(/at least 8/);
    expect(friendlyAuthError('Some novel backend error')).toBe('Some novel backend error');
  });
});
