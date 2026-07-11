'use client';

/**
 * Renders a UTC ISO instant in the viewer's local timezone (browser-local is
 * the product convention). Locale is pinned to en-US so dates match the
 * English UI instead of flipping to the browser language (a Korean browser
 * rendered "7월 13일 (월) 오후 6:00" inside otherwise-English screens). suppressHydrationWarning silences the expected
 * server(UTC)→client(local) text difference.
 */
export default function LocalTime({
  iso, withTime = true,
}: { iso: string; withTime?: boolean }) {
  if (!iso) return null;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', month: 'short', day: 'numeric' };
  return <time dateTime={iso} suppressHydrationWarning>{d.toLocaleString('en-US', opts)}</time>;
}
