'use client';

/**
 * Renders a UTC ISO instant in the viewer's local timezone. The strategy page
 * is a server component (which would format in the server's UTC tz), so dates
 * are handed to this client component to match the browser-local convention
 * used across the calendar. suppressHydrationWarning silences the expected
 * server(UTC)→client(local) text difference.
 */
export default function LocalDateTime({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {d.toLocaleString(undefined, opts)}
    </time>
  );
}
