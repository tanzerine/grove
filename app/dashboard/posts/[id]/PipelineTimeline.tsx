'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type LogEntry = { ts: number; step: string; event: 'start' | 'done' | 'fail'; message?: string };

const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  site_profile: 'Crawl site',
  research: 'Web search',
  topic_refiner: 'Pick angle',
  writer: 'Write article',
  persist: 'Save draft',
  cover_image: 'Cover image',
};

const IN_FLIGHT = new Set(['queued', 'researching', 'writing']);

function eventDot(event: string) {
  if (event === 'done') return { color: 'var(--moss)', icon: '✓' };
  if (event === 'fail') return { color: '#c33', icon: '✗' };
  return { color: '#d99c2b', icon: '●' };
}

export default function PipelineTimeline({ log, status }: { log: LogEntry[]; status: string }) {
  const router = useRouter();
  const interval = useRef<NodeJS.Timeout | null>(null);

  // auto-refresh every 2s while the post is in-flight
  useEffect(() => {
    if (!IN_FLIGHT.has(status)) {
      if (interval.current) { clearInterval(interval.current); interval.current = null; }
      return;
    }
    interval.current = setInterval(() => router.refresh(), 2000);
    return () => { if (interval.current) clearInterval(interval.current); };
  }, [status, router]);

  // dedupe trailing duplicates (e.g. cover_image start without done yet)
  const items = log.slice().sort((a, b) => a.ts - b.ts);

  if (items.length === 0) {
    return <p style={{ color: 'var(--clay)', fontSize: 14, fontStyle: 'italic' }}>Waiting to start…</p>;
  }

  const first = items[0]?.ts ?? Date.now();

  return (
    <div style={{ background: 'var(--paper)', borderRadius: 12, padding: 18, border: '1px solid var(--line)' }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Pipeline timeline
        {IN_FLIGHT.has(status) && <span style={{ marginLeft: 8, color: '#d99c2b' }}>● live</span>}
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        {items.map((e, i) => {
          const { color, icon } = eventDot(e.event);
          const elapsed = e.ts - first;
          const label = STEP_LABELS[e.step] ?? e.step;
          return (
            <li key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', alignItems: 'flex-start' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%', background: color,
                color: 'white', fontSize: 10, fontWeight: 700, marginTop: 2, flexShrink: 0,
              }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {label}
                  <span style={{ color: 'var(--clay)', fontWeight: 400, marginLeft: 8 }}>
                    {e.event}
                  </span>
                </div>
                {e.message && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--clay)', marginTop: 2, wordBreak: 'break-word' }}>
                    {e.message}
                  </div>
                )}
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--clay)', flexShrink: 0, marginTop: 4 }}>
                +{(elapsed / 1000).toFixed(1)}s
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
