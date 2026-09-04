'use client';
/**
 * The operator's month / week / day board.
 *
 * WHY THREE COLUMNS AND ONE ANCHOR, rather than a horizon switcher. The point
 * of a planner is that the day is planned AGAINST the week and the week
 * against the month; a switcher hides two of the three every time you look,
 * which is exactly when the day fills up with work that serves no goal. So all
 * three are on screen, all three describe the same moment, and the arrows in
 * any column header move that one shared anchor — nudging the month arrow
 * carries the week and day with it, because they are not independent things.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  type Horizon, type PlanStatus,
  periodLabel, relativeDayLabel, shiftPeriod, periodStart, todayKey,
  columnProgress, rollup,
} from '@/lib/operator-plan';
import type { PlanBoard, PlanItem } from '@/lib/operator-plan-store';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';

const COLUMN: Record<Horizon, { head: string; hint: string; placeholder: string }> = {
  month: { head: 'Month', hint: 'Goals — what has to be true by the 30th', placeholder: 'Add a goal…' },
  week: { head: 'Week', hint: 'Focus — the few things that move those goals', placeholder: 'Add a focus…' },
  day: { head: 'Day', hint: 'Tasks — what you actually sit down and do', placeholder: 'Add a task…' },
};

/** todo → doing → done → todo. `dropped` is deliberately off the cycle: it is
 *  a decision, not a stage, and it should take a deliberate click. */
const NEXT: Record<PlanStatus, PlanStatus> = { todo: 'doing', doing: 'done', done: 'todo', dropped: 'todo' };

const MARK: Record<PlanStatus, { glyph: string; fg: string; bd: string; bg: string }> = {
  todo: { glyph: '', fg: DIM, bd: 'rgba(255,255,255,0.24)', bg: 'transparent' },
  doing: { glyph: '◐', fg: 'var(--gv-amber)', bd: 'var(--gv-amber)', bg: 'transparent' },
  done: { glyph: '✓', fg: 'var(--gv-on-accent)', bd: ACCENT, bg: ACCENT },
  dropped: { glyph: '✕', fg: 'var(--gv-fainter)', bd: 'rgba(255,255,255,0.14)', bg: 'transparent' },
};

export default function PlanAdmin({ initial, serverToday }: { initial: PlanBoard; serverToday: string }) {
  const [board, setBoard] = useState(initial);
  const [anchor, setAnchor] = useState(initial.anchor);
  // Seeded from the server and corrected on mount, never computed during
  // render: server and client must agree on the first paint or React throws a
  // hydration mismatch over a date.
  const [today, setToday] = useState(serverToday);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/admin/plan?anchor=${day}`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Could not load the board.');
    setBoard(j.board as PlanBoard);
  }, []);

  /**
   * Correct the server's idea of "today" to the operator's.
   *
   * Vercel's functions run in UTC and the operator is in KST, so between
   * midnight and 09:00 local the server renders YESTERDAY's board and quietly
   * files the morning's tasks under the wrong date. The browser is the only
   * party that knows the right answer, so it re-anchors on mount — and only
   * when the two actually disagree, which is most of the day a no-op.
   */
  useEffect(() => {
    const local = todayKey();
    if (local === serverToday) return;
    setToday(local);
    setAnchor((a) => (a === serverToday ? local : a));
  }, [serverToday]);

  // The first render is the server's board, so skip the fetch until the anchor
  // actually moves — otherwise every page load pays for the same data twice.
  useEffect(() => {
    if (anchor !== board.anchor) void load(anchor);
  }, [anchor, board.anchor, load]);

  /** Move the shared anchor by one period of the given horizon. */
  function nudge(horizon: Horizon, delta: number) {
    if (horizon === 'day') return setAnchor(shiftPeriod('day', anchor, delta));
    // Land on the first day of the neighbouring month/week rather than keeping
    // the day-of-month: stepping from Jan 31 must not skip February.
    setAnchor(periodStart(horizon, shiftPeriod(horizon, board.keys[horizon], delta)));
  }

  /* ── mutations. Each one re-reads the board rather than patching state by
        hand: a status change moves a roll-up two columns away, and keeping
        those in sync locally is how the numbers start lying. ─────────────── */

  async function mutate(run: () => Promise<Response>) {
    setErr(null);
    const res = await run();
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.message ?? j.error ?? 'That did not save.');
    }
    await load(anchor);
  }

  const add = (horizon: Horizon, title: string, parent_id: string | null) => mutate(() =>
    fetch('/api/admin/plan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ horizon, period_key: board.keys[horizon], title, parent_id }),
    }));

  const patch = (id: string, body: Record<string, unknown>) => mutate(() =>
    fetch(`/api/admin/plan/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));

  const remove = (id: string) => mutate(() => fetch(`/api/admin/plan/${id}`, { method: 'DELETE' }));

  const move = (items: PlanItem[], index: number, delta: number) => {
    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    return mutate(() => fetch('/api/admin/plan', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: next.map((i) => i.id) }),
    }));
  };

  const all = [...board.items.month, ...board.items.week, ...board.items.day, ...board.weekLinkTargets];
  const progress = rollup(all);
  const isToday = anchor === today;

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setAnchor(today)} disabled={isToday} style={{
          ...btn, background: isToday ? 'transparent' : ACCENT,
          color: isToday ? 'var(--gv-faint)' : 'var(--gv-on-accent)',
          border: isToday ? `1px solid ${LINE}` : 'none', cursor: isToday ? 'default' : 'pointer',
        }}>Today</button>
        <span style={{ fontSize: 13, color: DIM }}>
          {periodLabel('day', anchor)} · {relativeDayLabel(anchor, today)}
        </span>
        {loading && <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>syncing…</span>}
        {err && <span style={{ fontSize: 12.5, color: 'var(--gv-red-text)' }}>{err}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        {(['month', 'week', 'day'] as Horizon[]).map((h) => (
          <Column
            key={h}
            horizon={h}
            periodKey={board.keys[h]}
            items={board.items[h]}
            parents={h === 'day' ? board.items.week : h === 'week' ? [...board.items.month, ...board.weekLinkTargets] : []}
            progress={progress}
            carried={h === 'day' ? board.carried : []}
            showCarried={h === 'day' && anchor >= today}
            onNudge={(d) => nudge(h, d)}
            onAdd={(title, parent) => add(h, title, parent)}
            onPatch={patch}
            onRemove={remove}
            onMove={(i, d) => move(board.items[h], i, d)}
            anchor={anchor}
          />
        ))}
      </div>
    </div>
  );
}

/* ── one horizon's column ───────────────────────────────────────────────── */

function Column(props: {
  horizon: Horizon; periodKey: string; items: PlanItem[]; parents: PlanItem[];
  progress: Map<string, { done: number; total: number }>;
  carried: PlanItem[]; showCarried: boolean; anchor: string;
  onNudge: (delta: number) => void;
  onAdd: (title: string, parent: string | null) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const { horizon, periodKey, items, parents, progress, carried, showCarried, anchor } = props;
  const [draft, setDraft] = useState('');
  const meta = COLUMN[horizon];
  const done = columnProgress(items);

  return (
    <section className="gv-card" style={{ background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 14px 12px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>{meta.head}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <Arrow label="←" onClick={() => props.onNudge(-1)} />
          <Arrow label="→" onClick={() => props.onNudge(1)} />
        </span>
      </header>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--gv-ink)', margin: 0, letterSpacing: '-0.01em' }}>
          {periodLabel(horizon, periodKey)}
        </h2>
        {done.total > 0 && (
          <span style={{ fontSize: 11.5, color: done.done === done.total ? ACCENT_INK : DIM }}>
            {done.done}/{done.total}
          </span>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--gv-faint)', margin: '3px 0 12px' }}>{meta.hint}</p>

      {showCarried && carried.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ fontSize: 11, color: 'var(--gv-amber)', fontWeight: 600, marginBottom: 6 }}>
            Carried over · {carried.length}
          </div>
          {carried.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--gv-soft)' }}>{c.title}</span>
              <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>{relativeDayLabel(c.period_key, anchor)}</span>
              {/* Pull forward, not copy: the same row moves, so its parent link
                  and its history survive and yesterday keeps no ghost of it. */}
              <button title="Pull to this day" onClick={() => props.onPatch(c.id, { period_key: anchor, horizon: 'day' })} style={ghost}>↓</button>
              <button title="Drop it" onClick={() => props.onPatch(c.id, { status: 'dropped' })} style={ghost}>⊘</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--gv-fainter)', padding: '2px 0 8px' }}>Nothing here yet.</p>
        )}
        {items.map((it, i) => (
          <Row
            key={it.id} item={it} index={i} last={i === items.length - 1}
            parents={parents} progress={progress.get(it.id)}
            onPatch={props.onPatch} onRemove={props.onRemove} onMove={props.onMove}
          />
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; setDraft(''); props.onAdd(t, null); }}
        style={{ marginTop: 8 }}
      >
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={meta.placeholder}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, borderRadius: 9,
            padding: '9px 11px', fontSize: 13, color: 'var(--gv-ink)', fontFamily: 'inherit', outline: 'none',
          }}
        />
      </form>
    </section>
  );
}

/* ── one line ───────────────────────────────────────────────────────────── */

function Row(props: {
  item: PlanItem; index: number; last: boolean; parents: PlanItem[];
  progress?: { done: number; total: number };
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const { item, index, last, parents, progress } = props;
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.title);
  const m = MARK[item.status];
  const muted = item.status === 'done' || item.status === 'dropped';

  function commit() {
    setEditing(false);
    const t = text.trim();
    if (!t || t === item.title) return setText(item.title);
    props.onPatch(item.id, { title: t });
  }

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 2px', borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}
    >
      <button
        title={item.status} onClick={() => props.onPatch(item.id, { status: NEXT[item.status] })}
        style={{
          width: 16, height: 16, flexShrink: 0, borderRadius: 999, cursor: 'pointer', padding: 0,
          border: `1.5px solid ${m.bd}`, background: m.bg, color: m.fg,
          fontSize: 9.5, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
        }}
      >{m.glyph}</button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(item.title); setEditing(false); } }}
            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${ACCENT}`, color: 'var(--gv-ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none', padding: '1px 0' }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)} title="Double-click to rename"
            style={{ fontSize: 13, color: muted ? 'var(--gv-faint)' : 'var(--gv-soft)', textDecoration: muted ? 'line-through' : 'none', cursor: 'text', wordBreak: 'break-word' }}
          >{item.title}</span>
        )}
        {parents.length > 0 && (
          <select
            value={item.parent_id ?? ''}
            onChange={(e) => props.onPatch(item.id, { parent_id: e.target.value || null })}
            style={{
              display: 'block', marginTop: 3, maxWidth: '100%', background: 'transparent',
              border: 'none', color: item.parent_id ? ACCENT_INK : 'var(--gv-fainter)',
              fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', padding: 0, outline: 'none',
            }}
          >
            <option value="">↳ not linked</option>
            {parents.map((p) => <option key={p.id} value={p.id}>↳ {p.title}</option>)}
          </select>
        )}
      </div>

      {progress && progress.total > 0 && (
        <span title={`${progress.done} of ${progress.total} linked items done`} style={{
          fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, flexShrink: 0,
          background: progress.done === progress.total ? 'rgba(162,255,1,0.16)' : 'rgba(255,255,255,0.07)',
          color: progress.done === progress.total ? ACCENT_INK : DIM,
        }}>{progress.done}/{progress.total}</span>
      )}

      {/* Revealed on hover: five always-on glyphs per line turn a plan into a
          control panel, and the list is meant to be read, not operated. */}
      <span style={{ display: 'flex', gap: 2, flexShrink: 0, opacity: hover ? 1 : 0, transition: 'opacity .12s' }}>
        <button title="Move up" onClick={() => props.onMove(index, -1)} disabled={index === 0} style={ghost}>↑</button>
        <button title="Move down" onClick={() => props.onMove(index, 1)} disabled={last} style={ghost}>↓</button>
        <button title="Drop (kept, not deleted)" onClick={() => props.onPatch(item.id, { status: 'dropped' })} style={ghost}>⊘</button>
        <button title="Delete" onClick={() => props.onRemove(item.id)} style={{ ...ghost, color: 'var(--gv-red-text)' }}>✕</button>
      </span>
    </div>
  );
}

function Arrow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 22, height: 22, borderRadius: 7, border: `1px solid ${LINE}`, background: 'transparent',
      color: DIM, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1, padding: 0,
    }}>{label}</button>
  );
}

const btn: React.CSSProperties = { borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' };
const ghost: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--gv-faint)', cursor: 'pointer',
  fontSize: 11.5, lineHeight: 1, padding: '2px 3px', fontFamily: 'inherit',
};
