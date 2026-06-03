'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Post = {
  id: string;
  title: string | null;
  topic: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  slug?: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  published: 'var(--moss)',
  scheduled: '#7B9EF0',
  review: '#E0A040',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getPostDate(p: Post): Date | null {
  const raw = p.published_at || p.scheduled_at;
  return raw ? new Date(raw) : null;
}

export default function CalendarClient({
  domainId, posts, unscheduledReview,
}: {
  domainId?: string;
  posts: Post[];
  unscheduledReview: Post[];
}) {
  const r = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [scheduling, setScheduling] = useState<{ postId: string; date: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  // Map date string 'YYYY-MM-DD' → posts
  const postsByDate = new Map<string, Post[]>();
  for (const p of posts) {
    const d = getPostDate(p);
    if (!d) continue;
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = `${d.getDate()}`;
    if (!postsByDate.has(key)) postsByDate.set(key, []);
    postsByDate.get(key)!.push(p);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  async function schedulePost() {
    if (!scheduling || !domainId) return;
    setBusy(true);
    await fetch(`/api/posts/${scheduling.postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scheduled_at: new Date(scheduling.date + 'T09:00:00').toISOString(),
        status: 'scheduled',
      }),
    });
    setBusy(false);
    setScheduling(null);
    setSelectedDay(null);
    r.refresh();
  }

  const selectedDayPosts = selectedDay ? (postsByDate.get(`${selectedDay}`) ?? []) : [];
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Calendar</h4>
        <Link href="/dashboard" style={{ fontSize: 12, color: 'var(--moss)', textDecoration: 'none' }}>← Pipeline</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
        {/* Calendar grid */}
        <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--line)' }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontFamily: 'Clash Display', fontSize: 20, fontWeight: 600 }}>{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} style={navBtn}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
            {DAYS.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--clay)', letterSpacing: '0.06em' }}>{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((day, i) => {
              const dayPosts = day ? (postsByDate.get(`${day}`) ?? []) : [];
              const active = day === selectedDay;
              const todayCell = day ? isToday(day) : false;
              const isPast = day ? new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate()) : false;
              return (
                <div
                  key={i}
                  onClick={() => day && setSelectedDay(active ? null : day)}
                  style={{
                    minHeight: 80, padding: '8px 10px',
                    borderRight: (i + 1) % 7 !== 0 ? '1px solid var(--line)' : 'none',
                    borderBottom: i < cells.length - 7 ? '1px solid var(--line)' : 'none',
                    background: active ? '#f0f6ff' : 'white',
                    cursor: day ? 'pointer' : 'default',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => day && !active && ((e.currentTarget as HTMLElement).style.background = 'var(--paper)')}
                  onMouseLeave={e => day && !active && ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  {day && (
                    <>
                      <div style={{
                        fontSize: 13, fontWeight: todayCell ? 700 : 400,
                        color: todayCell ? 'var(--moss)' : isPast ? 'var(--clay)' : 'var(--ink)',
                        width: 24, height: 24, borderRadius: '50%',
                        background: todayCell ? 'rgba(89,148,94,0.12)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 4,
                      }}>
                        {day}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayPosts.slice(0, 2).map(p => (
                          <div key={p.id} style={{
                            fontSize: 10, lineHeight: 1.3,
                            background: STATUS_COLOR[p.status] ?? 'var(--clay)',
                            color: 'white', borderRadius: 4, padding: '2px 5px',
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          }}>
                            {p.title ?? p.topic ?? '(draft)'}
                          </div>
                        ))}
                        {dayPosts.length > 2 && (
                          <div style={{ fontSize: 10, color: 'var(--clay)' }}>+{dayPosts.length - 2} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
            {[['Published', 'var(--moss)'], ['Scheduled', '#7B9EF0'], ['Review', '#E0A040']].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--clay)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} /> {label}
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Selected day detail */}
          {selectedDay && (
            <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: 'Clash Display', fontSize: 15, marginBottom: 12 }}>
                {MONTHS[month]} {selectedDay}
              </div>
              {selectedDayPosts.length === 0 ? (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--clay)', marginBottom: 14 }}>No posts. Schedule one:</p>
                  {unscheduledReview.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--clay)' }}>No posts awaiting scheduling.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {unscheduledReview.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setScheduling({
                            postId: p.id,
                            date: `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`,
                          })}
                          style={{
                            textAlign: 'left', padding: '8px 12px', borderRadius: 8,
                            border: `2px solid ${scheduling?.postId === p.id ? 'var(--moss)' : 'var(--line)'}`,
                            background: scheduling?.postId === p.id ? 'rgba(89,148,94,0.07)' : 'white',
                            cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                            color: 'var(--ink)',
                          }}
                        >
                          {p.title ?? p.topic ?? '(draft)'}
                        </button>
                      ))}
                      {scheduling && (
                        <button
                          onClick={schedulePost}
                          disabled={busy}
                          className="btn btn-primary btn-sm"
                          style={{ marginTop: 6 }}
                        >
                          {busy ? 'Scheduling…' : `Schedule for ${MONTHS[month]} ${selectedDay}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedDayPosts.map(p => (
                    <Link key={p.id} href={`/dashboard/posts/${p.id}`} style={{
                      display: 'block', padding: '10px 12px', borderRadius: 8,
                      border: '1px solid var(--line)', textDecoration: 'none', color: 'inherit',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                        {p.title ?? p.topic ?? '(draft)'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[p.status] ?? 'var(--clay)', display: 'inline-block' }} />
                        <span style={{ fontSize: 11, color: 'var(--clay)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{p.status}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Unscheduled review posts */}
          {unscheduledReview.length > 0 && (
            <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#E0A040', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Needs scheduling ({unscheduledReview.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {unscheduledReview.map(p => (
                  <Link key={p.id} href={`/dashboard/posts/${p.id}`} style={{
                    display: 'block', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--line)', textDecoration: 'none',
                    fontSize: 12, color: 'var(--ink)',
                  }}>
                    {p.title ?? p.topic ?? '(draft)'}
                  </Link>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--clay)', marginTop: 10 }}>
                Click a day on the calendar to schedule any of these.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 8,
  width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: 'var(--ink)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
};
