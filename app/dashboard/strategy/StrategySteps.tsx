'use client';
/**
 * "How your plan is built" — the six-step tracker at the top of the strategy
 * page. Answers the two questions the page used to leave open: what is grove
 * doing right now, and what (if anything) do I have to do.
 *
 * Layout follows the reference the owner picked: a numbered stepper across
 * the top with the live step drawn as a pill, a rail down the left listing
 * every step with its one-line result, and the selected step's artifact in
 * the main panel. The tracker opens on the step that's live; any step can be
 * clicked to see what it produced (or what it will).
 *
 * Motion is deliberate but quiet — the connector into the live step flows,
 * its node breathes, rows fade in as a step opens — so a page where nothing
 * is happening this second still reads as an agent mid-flight. Everything is
 * CSS (globals.css, the gv-steps-* rules) and switches off under
 * prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from '../gv-icons';
import { useT } from '../i18n';
import { msg } from '@/lib/i18n';
import type { StepsModel, Step, StepKey } from '@/lib/strategy/steps';
import StepPanel, { STEP_COPY } from './StepPanel';
import BuildPlanNow from './BuildPlanNow';
import LocalDateTime from './LocalDateTime';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/** Per-node animation delay — read by the gv-steps-* keyframes in globals.css. */
const stagger = (i: number) => ({ '--i': i } as unknown as React.CSSProperties);

const STATE_LABEL: Record<Step['state'], string> = {
  done: msg('Done'),
  active: msg('In progress'),
  needs_you: msg('Needs you'),
  pending: msg('Up next'),
};

/** Short, one-line results for the rail. Built from the facts; English keys. */
function railSummary(step: Step, t: ReturnType<typeof useT>): string {
  const f = step.facts;
  if (!f) {
    if (step.state === 'needs_you') return t('Waiting on you|step');
    if (step.state === 'active') return t('Running now');
    return t('Not started');
  }
  switch (f.kind) {
    case 'business':
      return [f.name, f.industry].filter(Boolean).join(' · ');
    case 'customers':
      if (f.chosen.length) return f.chosen.map((c) => t(c)).join(', ');
      return f.inferred || t('Inferred from your site');
    case 'brainstorm': {
      const seeds = f.seeds.length === 1 ? t('1 starting term') : t('{n} starting terms', { n: f.seeds.length });
      return f.considered ? `${seeds} · ${t('{n} phrases found', { n: f.considered })}` : seeds;
    }
    case 'score':
      if (f.considered) return t('{kept} kept of {n}', { kept: f.keywords.length, n: f.considered });
      return f.keywords.length === 1 ? t('1 keyword kept') : t('{n} keywords kept', { n: f.keywords.length });
    case 'cluster':
      return f.clusters.length === 1 ? t('1 cluster') : t('{n} clusters', { n: f.clusters.length });
    case 'schedule':
      return t('{live} of {total} live', { live: f.published, total: f.total });
  }
}

function Node({ step, selected, onSelect, label, current }: { step: Step; selected: boolean; onSelect: () => void; label: string; current: boolean }) {
  const t = useT();
  const done = step.state === 'done';
  const needs = step.state === 'needs_you';
  const live = current && !done;
  // The live step is drawn as a pill carrying its own label, like the
  // reference; every other node is a numbered circle with the label below.
  const ring = selected ? 'rgba(245,246,242,0.9)' : done ? 'rgba(162,255,1,0.45)' : needs ? 'rgba(224,200,120,0.6)' : 'rgba(255,255,255,0.14)';
  const fill = done ? 'rgba(162,255,1,0.14)' : needs ? 'rgba(224,200,120,0.12)' : 'rgba(255,255,255,0.03)';
  const ink = done ? ACCENT_INK : needs ? 'var(--gv-amber)' : 'var(--gv-dim)';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`gv-steps-node${live ? ' gv-steps-live' : ''}${live && needs ? ' gv-steps-needs' : ''}`}
      aria-current={current ? 'step' : undefined}
      aria-pressed={selected}
      style={{
        ...stagger(step.n - 1),
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0,
        height: 28, padding: live ? '0 12px 0 9px' : 0, width: live ? 'auto' : 28, justifyContent: 'center',
        borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
        // A live step blocked on the owner is amber, like its rail row — lime
        // would say "grove is on it" about a step grove is waiting on.
        background: live ? (needs ? 'rgba(224,200,120,0.1)' : 'rgba(162,255,1,0.1)') : fill,
        border: `1px solid ${live ? (needs ? 'rgba(224,200,120,0.55)' : 'rgba(162,255,1,0.5)') : ring}`,
        color: live ? (needs ? 'var(--gv-amber)' : ACCENT_INK) : ink,
        boxShadow: selected && !live ? '0 0 0 3px rgba(255,255,255,0.08)' : undefined,
        transition: 'border-color .2s, box-shadow .2s, background .2s',
      }}
    >
      {live && <span className="gv-steps-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: needs ? 'var(--gv-amber)' : ACCENT, flexShrink: 0 }} />}
      {done && !live
        ? <Icon name="check" size={12} />
        : <span style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{step.n}</span>}
      {live && <span className="gv-steps-pill-label" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>}
      {!live && (
        <span className="gv-steps-label" style={{ position: 'absolute', top: 34, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10.5, letterSpacing: '0.04em', fontWeight: 600, color: done ? 'var(--gv-dim)' : needs ? 'var(--gv-amber)' : 'var(--gv-fainter)' }}>
          {label}
        </span>
      )}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t(STATE_LABEL[step.state])}</span>
    </button>
  );
}

/** The connector between two nodes: solid once crossed, flowing into the live step, faint beyond it. */
function Connector({ from, to, currentIndex, live, needs }: { from: number; to: number; currentIndex: number; live: boolean; needs: boolean }) {
  const intoLive = live && to === currentIndex;
  const crossed = to < currentIndex || (!live && to === currentIndex);
  return (
    <span className="gv-steps-link" style={{ flex: 1, minWidth: 14, height: 1, position: 'relative', background: 'rgba(255,255,255,0.1)', margin: '0 8px', alignSelf: 'center' }}>
      {intoLive && <span className={`gv-steps-flow${needs ? ' gv-steps-needs' : ''}`} style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 3, borderRadius: 2 }} />}
      {crossed && <span className="gv-steps-fill" style={{ ...stagger(from), position: 'absolute', inset: 0, background: 'rgba(162,255,1,0.55)' }} />}
    </span>
  );
}

function RailRow({ step, selected, onSelect, summary }: { step: Step; selected: boolean; onSelect: () => void; summary: string }) {
  const t = useT();
  const done = step.state === 'done', needs = step.state === 'needs_you', active = step.state === 'active';
  return (
    <button
      type="button"
      onClick={onSelect}
      className="gv-steps-rail-btn"
      aria-pressed={selected}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        padding: '9px 10px', borderRadius: 10, border: `1px solid ${selected ? 'rgba(255,255,255,0.14)' : 'transparent'}`,
        background: selected ? 'var(--gv-veil-3)' : 'transparent', transition: 'background .15s, border-color .15s',
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? 'rgba(162,255,1,0.14)' : active ? 'rgba(162,255,1,0.08)' : needs ? 'rgba(224,200,120,0.14)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${done ? 'rgba(162,255,1,0.4)' : active ? 'rgba(162,255,1,0.45)' : needs ? 'rgba(224,200,120,0.5)' : 'rgba(255,255,255,0.12)'}`,
        color: done ? ACCENT_INK : needs ? 'var(--gv-amber)' : 'var(--gv-dim)' }}>
        {done ? <Icon name="check" size={10} /> : active ? <span className="gv-steps-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }} /> : needs ? <span style={{ fontSize: 10, fontWeight: 800 }}>!</span> : <span style={{ fontSize: 9.5, fontWeight: 700 }}>{step.n}</span>}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', fontWeight: 700, flexShrink: 0 }}>{t('step {n}', { n: step.n })}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: done || active || needs ? 'var(--gv-ink)' : 'var(--gv-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(STEP_COPY[step.key].short)}</span>
        </span>
        <span style={{ display: 'block', fontSize: 11.5, color: needs ? 'var(--gv-amber)' : 'var(--gv-faint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
      </span>
    </button>
  );
}

export type StrategyStepsProps = {
  model: StepsModel;
  domainId: string;
  hostname: string;
  /** The month the plan on screen covers, already formatted for the reader. */
  planMonth: string | null;
  /** The month a rebuild would plan, when the plan on screen is stale. */
  currentMonth: string;
  /** Pillar id → colour, so keyword rows and clusters match the page below. */
  pillarColors: Record<string, string>;
};

export default function StrategySteps({ model, domainId, hostname, planMonth, currentMonth, pillarColors }: StrategyStepsProps) {
  const t = useT();
  const [selected, setSelected] = useState<StepKey>(model.current);
  const track = useRef<HTMLDivElement>(null);
  // On a phone the track scrolls sideways; make sure it opens on the live
  // step rather than on step 1 with the one that matters off-screen.
  // scrollLeft, not scrollIntoView: the latter would also scroll the page.
  useEffect(() => {
    const el = track.current;
    const live = el?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!el || !live || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, live.offsetLeft - el.clientWidth / 2 + live.offsetWidth / 2);
  }, [model.current]);
  const steps = model.steps;
  const currentIndex = steps.findIndex((s) => s.key === model.current);
  const cur = steps[currentIndex];
  const sel = steps.find((s) => s.key === selected) ?? cur;
  const colorFor = (id: string) => pillarColors[id] ?? 'var(--gv-dim)';

  // One sentence on where things stand — the headline the whole card answers.
  const headline = (() => {
    if (cur.key === 'business' && cur.state === 'needs_you') return t('Verify your domain and grove starts reading it.');
    if (cur.key === 'customers' && cur.state === 'needs_you') return t('Five quick questions, then grove profiles your customers.');
    if (cur.key === 'brainstorm' && cur.state === 'needs_you') return t('{month}’s plan has run its course. {next} hasn’t been researched yet.', { month: planMonth ?? '', next: currentMonth });
    if (cur.key === 'brainstorm') return t('grove is researching what your customers search for.');
    if (cur.key === 'schedule' && cur.state === 'done') return t('Every article planned for {month} is live. Next month’s plan builds itself.', { month: planMonth ?? currentMonth });
    if (cur.key === 'schedule') return t('Step 6 of 6 — grove is writing and publishing {month}’s articles.', { month: planMonth ?? currentMonth });
    return t('Step {n} of 6 — {title}.', { n: cur.n, title: t(STEP_COPY[cur.key].title) });
  })();

  const a = model.action;
  const move: { title: string; sub: React.ReactNode; cta?: React.ReactNode; needsYou: boolean } = (() => {
    const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 10, textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer' };
    switch (a.kind) {
      case 'verify':
        return { needsYou: true, title: t('Verify your domain'), sub: t('A DNS record or a file upload proves it’s yours. grove reads the site right after.'),
          cta: <Link href={`/onboarding/verify?domain=${domainId}`} className="gv-btn" style={btn}>{t('Verify domain')} <Icon name="arrow" size={13} /></Link> };
      case 'interview':
        return { needsYou: true, title: t('Answer 5 questions'), sub: t('Who your customers are and what the blog should do for you — about two minutes.'),
          cta: <Link href="/onboarding/intent" className="gv-btn" style={btn}>{t('Answer 5 questions')} <Icon name="arrow" size={13} /></Link> };
      case 'build':
        return { needsYou: true, title: t('Build this month’s plan'), sub: t('Your answers are in. The strategist takes about a minute, and retries on its own every hour.'),
          cta: <BuildPlanNow domainId={domainId} label={t('Build the plan now →')} compact /> };
      case 'rebuild':
        return { needsYou: true, title: t('Build {month}’s plan', { month: currentMonth }), sub: t('The plan below is {month}’s. This usually rebuilds itself within the hour; build it now if you’d rather not wait.', { month: planMonth ?? '' }),
          cta: <BuildPlanNow domainId={domainId} label={t('Build {month}’s plan →', { month: currentMonth })} compact /> };
      case 'review':
        return { needsYou: true, title: a.count === 1 ? t('Review 1 draft') : t('Review {n} drafts', { n: a.count }), sub: t('They publish as soon as you approve them.'),
          cta: <Link href="/dashboard/pipeline" className="gv-btn" style={btn}>{t('Open the pipeline')} <Icon name="arrow" size={13} /></Link> };
      case 'wait':
        return { needsYou: false, title: t('Nothing needed from you'),
          sub: a.next ? <>{t('grove publishes on schedule. Next article:')} <LocalDateTime iso={a.next} withTime /></> : t('grove publishes on schedule and reports back here.'),
          cta: <a href="#plan-chat" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--gv-dim)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('Change the plan in chat')} <Icon name="arrow" size={13} /></a> };
    }
  })();

  return (
    <section className="gv-card gv-steps" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px 20px', marginBottom: 14 }}>
      {/* ── header: where we are + your move ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gv-dim)' }}>
            <Icon name="compass" size={13} /> {t('How your plan is built')}
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.015em', color: 'var(--gv-ink)', margin: '10px 0 0', maxWidth: 640 }}>{headline}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', margin: '6px 0 0', lineHeight: 1.55, maxWidth: 640 }}>
            {t('Six steps from your site to a publishing calendar. Click any step to see what it produced.')}
          </p>
        </div>
        <div className="gv-steps-move" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '12px 14px 12px 16px', borderRadius: 13, background: move.needsYou ? 'rgba(162,255,1,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${move.needsYou ? 'rgba(162,255,1,0.32)' : 'rgba(255,255,255,0.1)'}`, minWidth: 280, maxWidth: 460 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: move.needsYou ? ACCENT_INK : 'var(--gv-fainter)' }}>
              {move.needsYou && <span className="gv-steps-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }} />}
              {t('Your move')}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)', marginTop: 4 }}>{move.title}</div>
            <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5, marginTop: 3 }}>{move.sub}</div>
          </div>
          {move.cta && <div style={{ flexShrink: 0 }}>{move.cta}</div>}
        </div>
      </div>

      {/* ── stepper ── */}
      <div ref={track} className="gv-steps-track" style={{ display: 'flex', alignItems: 'center', padding: '26px 48px 42px', marginTop: 6, overflowX: 'auto' }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: 'contents' }}>
            {i > 0 && <Connector from={i - 1} to={i} currentIndex={currentIndex} live={cur.state !== 'done'} needs={cur.state === 'needs_you'} />}
            <Node step={s} selected={s.key === selected} onSelect={() => setSelected(s.key)} label={t(STEP_COPY[s.key].short)} current={s.key === model.current} />
          </div>
        ))}
      </div>

      {/* ── rail + panel ── */}
      <div className="gv-steps-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {steps.map((s) => (
            <RailRow key={s.key} step={s} selected={s.key === selected} onSelect={() => setSelected(s.key)} summary={railSummary(s, t)} />
          ))}
        </div>
        <StepPanel key={sel.key} step={sel} hostname={hostname} colorFor={colorFor} />
      </div>
    </section>
  );
}
