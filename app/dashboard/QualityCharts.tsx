/**
 * Article-quality visualizations — pure SVG/JSX, no chart library, no hooks,
 * so they render server-side and stay on the design system (Clash Display
 * numerals, DM Mono labels, moss/amber/red score bands shared with PostRow).
 */
import Link from 'next/link';

export type RubricScores = {
  strategic_fit?: number | null;
  marketing?: number | null;
  craft?: number | null;
  safety?: number | null;
  overall?: number | null;
};

/** Score band colors — single source, same thresholds as PostRow. */
export function bandColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'var(--clay)';
  return v >= 70 ? 'var(--moss)' : v >= 40 ? '#E0A040' : '#b04a3b';
}

/* ─────────────────────────── donut ring ─────────────────────────── */

export function ScoreRing({ value, size = 92, label = 'overall' }: { value: number; size?: number; label?: string }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = bandColor(v);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} role="img" aria-label={`${label} score ${v} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--paper)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'Clash Display', fontSize: size * 0.3, lineHeight: 1, color: 'var(--ink)' }}>{v}</span>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── rubric bars ─────────────────────────── */

const RUBRIC_LABELS: Array<[keyof RubricScores, string]> = [
  ['strategic_fit', 'strategic fit'],
  ['marketing', 'marketing'],
  ['craft', 'craft'],
  ['safety', 'safety'],
];

export function RubricBars({ scores }: { scores: RubricScores | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 200 }}>
      {RUBRIC_LABELS.map(([key, label]) => {
        const v = Math.max(0, Math.min(100, Number(scores?.[key] ?? 0)));
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--clay)' }}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>{v}</span>
            </div>
            <div style={{ height: 6, marginTop: 4, background: 'var(--paper)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${v}%`, height: '100%', background: bandColor(v), transition: 'width .2s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────── score columns across articles ────────────────── */

export type ScoredArticle = { id: string; title: string | null; overall: number };

/**
 * Mini column chart: one band-colored column per scored article (oldest →
 * newest), dashed average line, every column links to its post.
 */
export function QualityColumns({ items, height = 96 }: { items: ScoredArticle[]; height?: number }) {
  if (!items.length) return null;
  const avg = Math.round(items.reduce((a, i) => a + i.overall, 0) / items.length);
  return (
    <div>
      <div style={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {/* average line */}
        <div
          aria-hidden
          style={{ position: 'absolute', left: 0, right: 0, bottom: `${avg}%`, borderTop: '1.5px dashed var(--clay)', opacity: 0.55 }}
        />
        <span
          className="mono"
          style={{ position: 'absolute', right: 0, bottom: `calc(${avg}% + 3px)`, fontSize: 10, color: 'var(--clay)' }}
        >
          avg {avg}
        </span>
        {items.map((it) => (
          <Link
            key={it.id}
            href={`/dashboard/posts/${it.id}`}
            title={`${it.title ?? '(untitled)'} — ${it.overall}/100`}
            style={{
              flex: 1, maxWidth: 34, minWidth: 10,
              height: `${Math.max(4, it.overall)}%`,
              background: bandColor(it.overall),
              borderRadius: '4px 4px 0 0',
              opacity: 0.9,
            }}
          />
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 0, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--clay)' }}>older</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--clay)' }}>newest</span>
      </div>
    </div>
  );
}
