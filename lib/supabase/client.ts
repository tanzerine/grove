'use client';
import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  // Fallbacks only exist so the production build can prerender these
  // pages even when envs are absent. At runtime in the browser, the real
  // NEXT_PUBLIC_* values (inlined at build time) will be present.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
  return createBrowserClient(url, key);
}
