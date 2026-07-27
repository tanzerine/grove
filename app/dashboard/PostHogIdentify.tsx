'use client';
import { useEffect } from 'react';
import posthog from 'posthog-js';
import { useChrome } from './chrome-context';

export default function PostHogIdentify() {
  const { userId, email, plan } = useChrome();

  useEffect(() => {
    if (!userId) return;
    posthog.identify(userId, { email, plan });
  }, [userId, email, plan]);

  return null;
}
