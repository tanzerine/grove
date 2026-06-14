'use client';
import { useEffect, useRef, useState } from 'react';
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
  const isLive = IN_FLIGHT.has(status);
  const [collapsed, setCollapsed] = useState(!isLive);

  // auto-refresh every 2s while the post is in-flight
  useEffect(() => {
    if (!isLive) {
      if (interval.current) { clearInterval(interval.current); interval.current = null; }
      return;
    }
    interval.current = setInterval(() => router.refresh(), 2000);
    return () => { if (interval.current) clearInterval(interval.current); };
  }, [isLive, router]);

  // auto-expand when the post becomes live
  useEffect(() => {
    if (isLive) setCollapsed(false);
  }, [isLive]);

  const items = log.slice().sort((a, b) => a.ts - b.ts);
  const first = items[0]?.ts ?? Date.now();

  return (
    <div style={{ background: 'var(--paper)', borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>

        {/* ── Header / toggle ── */}
        <button
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          style={{
            display: 'flex', alignItems: 'center', width: '100%',
            padding: '14px 18px', background: 'none', border: 'none',
            cursor: 'pointer', textAlign: 'left', gap: 8,
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: 'var(--moss)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
            Pipeline timeline
            {isLive && (
              <span className="grove-live-dot" style={{ marginLeft: 8, color: '#d99c2b' }}>● live</span>
            )}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--clay)', marginRight: 6 }}>
            {collapsed ? 'Show' : 'Hide'}
          </span>
          <span className={`grove-toggle-arrow ${collapsed ? '' : 'open'}`}>▶</span>
        </button>

        {/* ── Collapsible body (grid-rows trick for smooth animate) ── */}
        <div className={`grove-collapsible ${collapsed ? 'closed' : 'open'}`}>
          <div className="grove-collapsible-inner">
            <div style={{ padding: '0 18px 18px' }}>

              {/* Log entries */}
              {items.length > 0 && (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
                  {items.map((e, i) => {
                    const { color, icon } = eventDot(e.event);
                    const elapsed = e.ts - first;
                    const label = STEP_LABELS[e.step] ?? e.step;
                    const isActive = isLive && i === items.length - 1 && e.event === 'start';
                    return (
                      <li key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', alignItems: 'flex-start' }}>
                        <span
                          className={isActive ? 'grove-active-icon' : undefined}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: '50%', background: color,
                            color: 'white', fontSize: 10, fontWeight: 700, marginTop: 2, flexShrink: 0,
                          }}
                        >
                          {icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={isActive ? 'grove-active-row' : undefined} style={{ fontSize: 13, fontWeight: 500 }}>
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
              )}

              {/* Empty + not live */}
              {items.length === 0 && !isLive && (
                <p style={{ color: 'var(--clay)', fontSize: 14, fontStyle: 'italic', margin: 0 }}>Waiting to start…</p>
              )}

              {/* Thinking indicator — shown whenever in-flight */}
              {isLive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: items.length > 0 ? 12 : 0, paddingLeft: items.length > 0 ? 30 : 0 }}>
                  <span className="grove-think-dot" />
                  <span className="grove-think-dot" />
                  <span className="grove-think-dot" />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--clay)', marginLeft: 6 }}>working…</span>
                </div>
              )}

            </div>
          </div>
        </div>

      </div>
  );
}
