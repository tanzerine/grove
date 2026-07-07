'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Invisible dashboard-usage heartbeat. Feeds the admin Users page (retention,
 * time-in-app, last seen) via /api/activity:
 *  - a pageview beat on every dashboard route change
 *  - a seconds beat every 30s while the tab is actually visible
 *  - a final flush via sendBeacon when the tab hides/closes
 * Silent by design — failures are swallowed, no console noise, no UI.
 */

const BEAT_MS = 30_000;

function send(payload: { path?: string; seconds?: number; pageview?: boolean }, beacon = false) {
  const body = JSON.stringify(payload);
  try {
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/activity', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* tracking must never break the app */ }
}

export default function ActivityPing() {
  const pathname = usePathname() ?? '/dashboard';
  const pathRef = useRef(pathname);
  const sinceRef = useRef(Date.now());
  pathRef.current = pathname;

  // Route change → pageview (also covers the initial load).
  useEffect(() => {
    send({ path: pathname, pageview: true });
  }, [pathname]);

  // Visible-time heartbeat + flush on hide.
  useEffect(() => {
    sinceRef.current = Date.now();

    const flush = (beacon: boolean) => {
      const secs = Math.round((Date.now() - sinceRef.current) / 1000);
      sinceRef.current = Date.now();
      if (secs > 0 && secs <= 600) send({ path: pathRef.current, seconds: Math.min(secs, 120) }, beacon);
    };

    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') flush(false);
      else sinceRef.current = Date.now(); // hidden — don't count this interval
    }, BEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
      else sinceRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);

    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
    };
  }, []);

  return null;
}
