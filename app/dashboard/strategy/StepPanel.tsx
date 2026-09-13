'use client';
/**
 * The artifact of ONE strategy step — what grove found, read, chose or shipped
 * at that stage — drawn from the facts lib/strategy/steps derives. The rail
 * and stepper in StrategySteps.tsx pick which step; this only renders it.
 *
 * Every panel carries the same three things, top to bottom: what the step
 * does (one sentence, so the owner never has to guess what a "cluster" is),
 * the result, and a footnote saying where the result came from. A pending
 * step renders the sentence alone, with what it is waiting on.
 */
import Link from 'next/link';
import Icon from '../gv-icons';
import { useT } from '../i18n';
import { msg, type T } from '@/lib/i18n';
import type { Step, StepKey, StepFacts, KeywordRow } from '@/lib/strategy/steps';
import type { SearchIntent } from '@/lib/strategy/keywords';
import LocalDateTime from './LocalDateTime';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/** English source strings; translated at render (see lib/i18n). */
export const STEP_COPY: Record<StepKey, { short: string; title: string; does: string; icon: string }> = {
  business: {
    short: msg('Your business'),
    title: msg('Read your business'),
    does: msg('grove reads your site and notes what you sell, who it is for and what sets it apart.'),
    icon: 'building',
  },
  customers: {
    short: msg('Your customers'),
    title: msg('Profile your customers'),
    does: msg('From your answers and your site, grove sketches the reader every article is written for.'),
    icon: 'target',
  },
  brainstorm: {
    short: msg('Keyword ideas'),
    title: msg('Brainstorm what they search'),
    does: msg('grove lists the phrases those customers would actually type into a search engine.'),
    icon: 'search2',
  },
  score: {
    short: msg('Score keywords'),
    title: msg('Pick the keywords worth chasing'),
    does: msg('Each phrase is weighed on how many people search it against how hard it is to rank, and only the best are kept.'),
    icon: 'gauge',
  },
  cluster: {
    short: msg('Clusters'),
    title: msg('Build keyword clusters'),
    does: msg('The keepers are grouped into clusters, so every article backs up the others and the site earns authority on the whole topic.'),
    icon: 'spark',
  },
  schedule: {
    short: msg('Write & schedule'),
    title: msg('Write and schedule the content'),
    does: msg('One article per keyword: drafted in your voice, checked by the manager, published on the calendar.'),
    icon: 'calendar',
  },
};

const INTENT: Record<SearchIntent, { label: string; color: string; border: string }> = {
  informational: { label: msg('Informational'), color: 'var(--gv-soft)', border: 'rgba(255,255,255,0.22)' },
  commercial: { label: msg('Commercial'), color: 'var(--gv-sky)', border: 'rgba(127,182,230,0.4)' },
  transactional: { label: msg('Transactional'), color: ACCENT_INK, border: 'rgba(162,255,1,0.4)' },
  navigational: { label: msg('Navigational'), color: 'var(--gv-dim)', border: 'rgba(255,255,255,0.14)' },
};

const FUNNEL: Record<'editorial' | 'contextual' | 'conversion', string> = { editorial: 'TOFU', contextual: 'MOFU', conversion: 'BOFU' };

const EYEBROW: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gv-fainter)', fontWeight: 700 };
const CHIP: React.CSSProperties = { fontSize: 12, color: 'var(--gv-soft)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '4px 9px', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' };
const MONO: React.CSSProperties = { fontFamily: '"DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace' };
/** Per-row animation delay — read by the .gv-steps-row keyframe in globals.css. */
const stagger = (i: number) => ({ '--i': i } as unknown as React.CSSProperties);

function Chips({ items, mono, max = 12 }: { items: string[]; mono?: boolean; max?: number }) {
  const t = useT();
  const shown = items.slice(0, max);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {shown.map((s, i) => (
        <span key={i} className="gv-steps-row" style={{ ...CHIP, ...(mono ? MONO : {}), ...stagger(i) }}>{s}</span>
      ))}
      {items.length > shown.length && (
        <span style={{ ...CHIP, color: 'var(--gv-faint)' }}>{t('+{n} more', { n: items.length - shown.length })}</span>
      )}
    </div>
  );
}

function Block({ label, children, i = 0 }: { label: string; children: React.ReactNode; i?: number }) {
  return (
    <div className="gv-steps-row" style={{ ...stagger(i) }}>
      <div style={{ ...EYEBROW, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 18, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 11.5, lineHeight: 1.5, color: 'var(--gv-faint)' }}>
      <span style={{ display: 'flex', color: 'var(--gv-fainter)', marginTop: 2 }}><Icon name="q" size={12} /></span>
      <span>{children}</span>
    </div>
  );
}

function IntentChip({ intent }: { intent: SearchIntent }) {
  const t = useT();
  const s = INTENT[intent];
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {t(s.label)}
    </span>
  );
}

/** The step hasn't produced anything yet: say what it will do and what it waits on. */
function Pending({ step, t }: { step: Step; t: T }) {
  const waitingOn = step.n > 1 ? t('Starts after step {n}.', { n: step.n - 1 }) : '';
  return (
    <div style={{ padding: '26px 8px 18px', textAlign: 'center' }}>
      <span style={{ display: 'inline-flex', width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.16)', color: 'var(--gv-dim)' }}>
        <Icon name={STEP_COPY[step.key].icon} size={19} />
      </span>
      <div style={{ fontSize: 13.5, color: 'var(--gv-soft)', marginTop: 14, lineHeight: 1.55, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
        {step.state === 'active' ? t('grove is working on this now.') : t('Not started yet.')} {waitingOn}
      </div>
    </div>
  );
}

function BusinessPanel({ f, t, hostname }: { f: Extract<StepFacts, { kind: 'business' }>; t: T; hostname: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="gv-steps-row" style={{ display: 'flex', alignItems: 'center', gap: 12, ...stagger(0) }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(162,255,1,0.12)', border: '1px solid rgba(162,255,1,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT_INK, flexShrink: 0 }}>
          <Icon name="building" size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gv-ink)' }}>{f.name}</div>
          <div style={{ fontSize: 12, color: 'var(--gv-faint)', ...MONO }}>{hostname}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: ACCENT_INK, background: 'rgba(162,255,1,0.1)', border: '1px solid rgba(162,255,1,0.3)', borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>
          <Icon name="check" size={11} /> {t('Found')}
        </span>
      </div>
      {f.description && (
        <p className="gv-steps-row" style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--gv-soft)', margin: 0, ...stagger(1) }}>{f.description}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18 }}>
        {f.products.length > 0 && <Block label={t('What you sell')} i={2}><Chips items={f.products} /></Block>}
        {f.valueProps.length > 0 && <Block label={t('What sets you apart')} i={3}><Chips items={f.valueProps} /></Block>}
      </div>
      <Foot>
        {[f.industry, f.geography].filter(Boolean).join(' · ')}
        {f.industry || f.geography ? ' · ' : ''}
        {f.pagesCrawled === 1 ? t('1 page read') : t('{n} pages read', { n: f.pagesCrawled })}
      </Foot>
    </div>
  );
}

function CustomersPanel({ f, t }: { f: Extract<StepFacts, { kind: 'customers' }>; t: T }) {
  const nothing = !f.chosen.length && !f.inferred && !f.personas.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {f.chosen.length > 0 && (
        <Block label={t('Who you asked us to write for')} i={0}>
          {/* Interview options are stored in English and translated on display. */}
          <Chips items={f.chosen.map((c) => t(c))} />
        </Block>
      )}
      {f.inferred && (
        <Block label={t('Who your site speaks to')} i={1}>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--gv-soft)', margin: 0 }}>{f.inferred}</p>
        </Block>
      )}
      {(f.goal || f.kpi) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18 }}>
          {f.goal && <Block label={t('What the blog must do')} i={2}><span style={{ fontSize: 13.5, color: 'var(--gv-ink)', fontWeight: 600 }}>{t(f.goal)}</span></Block>}
          {f.kpi && <Block label={t('The number to move')} i={3}><span style={{ fontSize: 13.5, color: 'var(--gv-ink)', fontWeight: 600 }}>{t(f.kpi)}</span></Block>}
        </div>
      )}
      {f.personas.length > 0 && (
        <Block label={t('The reader of each cluster')} i={4}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {f.personas.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
                <span style={{ color: 'var(--gv-dim)', flexShrink: 0, minWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.pillar}</span>
                <span style={{ color: 'var(--gv-soft)' }}>{p.audience}</span>
              </div>
            ))}
          </div>
        </Block>
      )}
      {nothing && <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', margin: 0 }}>{t('Nothing on file yet.')}</p>}
      <Foot>{t('Your answers outrank what the crawl inferred whenever the two disagree.')}</Foot>
    </div>
  );
}

function BrainstormPanel({ f, t }: { f: Extract<StepFacts, { kind: 'brainstorm' }>; t: T }) {
  const byIntent = (['informational', 'commercial', 'transactional'] as SearchIntent[])
    .map((k) => ({ k, items: f.phrases.filter((p) => p.intent === k).map((p) => p.keyword) }))
    .filter((g) => g.items.length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Block label={t('Where the research starts')} i={0}>
        {f.seeds.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {f.seeds.map((s, i) => (
              <span key={i} className="gv-steps-row" style={{ ...CHIP, ...MONO, display: 'inline-flex', alignItems: 'center', gap: 6, ...stagger(i) }}>
                <span style={{ display: 'flex', color: 'var(--gv-fainter)' }}><Icon name="search2" size={11} /></span>{s}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: 0 }}>{t('No head terms yet — they come from what your site sells.')}</p>
        )}
      </Block>
      {byIntent.length > 0 && byIntent.map((g, gi) => (
        <Block key={g.k} label={t(INTENT[g.k].label)} i={gi + 1}>
          <Chips items={g.items} max={10} />
        </Block>
      ))}
      <Foot>
        {t('grove asks the search engine what people type after each of these, in {lang}, and keeps the suggestions in the order searchers use them. The brand name is left out on purpose: nobody searches for a product they have not heard of.', { lang: t(LANG_NAME[f.language] ?? 'English') })}
      </Foot>
    </div>
  );
}

const LANG_NAME: Record<string, string> = { en: msg('English'), ko: msg('Korean'), es: msg('Spanish'), zh: msg('Chinese') };

function ScorePanel({ f, t, colorFor }: { f: Extract<StepFacts, { kind: 'score' }>; t: T; colorFor: (pillarId: string) => string }) {
  const cols = f.scored ? 'minmax(0,1.4fr) 110px 90px 70px minmax(0,1.2fr)' : 'minmax(0,1.2fr) 118px minmax(0,1.4fr)';
  const th: React.CSSProperties = { ...EYEBROW, padding: '0 0 8px' };
  const rows = f.keywords.slice(0, 14);
  const fmt = (n: number | null | undefined) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  return (
    <div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', margin: 0 }}>{t('The plan has no target keywords yet.')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: f.scored ? 620 : 440 }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={th}>{t('Keyword')}</span>
              <span style={th}>{t('Intent')}</span>
              {f.scored && <span style={th}>{t('Searches / mo')}</span>}
              {f.scored && <span style={th}>{t('KD')}</span>}
              <span style={th}>{t('Article')}</span>
            </div>
            {rows.map((k: KeywordRow, i) => (
              <div key={i} className="gv-steps-row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', ...stagger(i) }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colorFor(k.pillarId), flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.keyword}</span>
                </span>
                <span><IntentChip intent={k.intent} /></span>
                {f.scored && <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', fontVariantNumeric: 'tabular-nums' }}>{fmt(k.volume)}</span>}
                {f.scored && <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', fontVariantNumeric: 'tabular-nums' }}>{fmt(k.kd)}</span>}
                <span style={{ fontSize: 12, color: 'var(--gv-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.topic}</span>
              </div>
            ))}
            {f.keywords.length > rows.length && (
              <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', padding: '8px 0 0' }}>{t('+{n} more', { n: f.keywords.length - rows.length })}</div>
            )}
          </div>
        </div>
      )}
      <Foot>
        {f.scored
          ? t('Searches per month and keyword difficulty (KD, 0–100) come from live keyword data. One keyword per article, so two pages never compete for the same query.')
          : t('Ranked by live search demand — the order a search engine suggests them in. One keyword per article, so two pages never compete for the same query.')}
      </Foot>
    </div>
  );
}

function ClusterPanel({ f, t, colorFor }: { f: Extract<StepFacts, { kind: 'cluster' }>; t: T; colorFor: (pillarId: string) => string }) {
  return (
    <div>
      {f.clusters.length === 0 ? (
        <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', margin: 0 }}>{t('No clusters yet.')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {f.clusters.map((c, i) => {
            const color = colorFor(c.id);
            return (
              <div key={c.id} className="gv-steps-row" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 15px', ...stagger(i) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gv-ink)', flex: 1, minWidth: 0, lineHeight: 1.3 }}>{c.title}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>{FUNNEL[c.intent]}</span>
                </div>
                {c.promise && <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5, marginTop: 5 }}>{c.promise}</div>}
                <div style={{ fontSize: 11, color: 'var(--gv-faint)', margin: '10px 0 8px' }}>
                  {c.slots === 1 ? t('1 article') : t('{n} articles', { n: c.slots })}
                  {c.keywords.length ? ` · ${c.keywords.length === 1 ? t('1 keyword') : t('{n} keywords', { n: c.keywords.length })}` : ''}
                </div>
                {c.keywords.length > 0 && <Chips items={c.keywords} max={4} />}
              </div>
            );
          })}
        </div>
      )}
      <Foot>{t('A cluster is one topic seen from several searches. Articles in it link to each other, which is how a new site earns authority faster than one-off posts can.')}</Foot>
    </div>
  );
}

function SchedulePanel({ f, t, state }: { f: Extract<StepFacts, { kind: 'schedule' }>; t: T; state: Step['state'] }) {
  const pct = f.total ? Math.round((f.published / f.total) * 100) : 0;
  const inFlight = f.total ? Math.round(((f.drafting + f.review + f.scheduled) / f.total) * 100) : 0;
  const stats: { v: string; l: string }[] = [
    { v: String(f.published), l: t('Live') },
    { v: String(f.scheduled), l: t('Scheduled') },
    { v: String(f.drafting), l: t('Drafting') },
    { v: String(f.review), l: t('In review') },
  ];
  const track = [
    { name: t('Live SERP research'), icon: 'search2', runs: f.runs.research === 1 ? t('1 run') : t('{n} runs', { n: f.runs.research }), desc: t('Crawls search results & competitor posts to find the ranking gaps worth taking.') },
    { name: t('Writer'), icon: 'pen', runs: f.runs.drafts === 1 ? t('1 draft') : t('{n} drafts', { n: f.runs.drafts }), desc: t('Drafts every post in your brand voice, structured for the target keyword.') },
    { name: t('Manager'), icon: 'manager', runs: f.runs.reviews === 1 ? t('1 review') : t('{n} reviews', { n: f.runs.reviews }), desc: t('Scores each draft 0–100 on strategy fit & craft, and gates publish.') },
    { name: t('Analytics'), icon: 'analytics', runs: t('continuous'), desc: t('Reads first-party events to grade the plan and tune next month.') },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="gv-steps-row" style={{ ...stagger(0) }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--gv-ink)' }}>{f.published}</span>
          <span style={{ fontSize: 13, color: 'var(--gv-dim)' }}>{t('of {n} articles live', { n: f.total })}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)' }}>
            {f.next ? <>{t('Next article')} <LocalDateTime iso={f.next} /></> : state === 'done' ? t('Everything planned is live') : null}
          </span>
        </div>
        <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 10 }}>
          <div className="gv-steps-bar" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, background: ACCENT, borderRadius: 99 }} />
          <div className={state === 'active' ? 'gv-steps-bar gv-steps-flow' : 'gv-steps-bar'} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: `${inFlight}%`, opacity: 0.55 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        {stats.map((s, i) => (
          <div key={i} className="gv-steps-row" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '10px 12px', ...stagger(i + 1) }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--gv-ink)', fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
            <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>
      <Block label={t('How each article gets made')} i={5}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {track.map((x, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12, paddingTop: 2 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--gv-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={x.icon} size={15} /></span>
                {i < track.length - 1 && <span style={{ flex: 1, width: 1, minHeight: 8, background: 'rgba(255,255,255,0.14)', marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gv-ink)' }}>{x.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{x.runs}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gv-dim)', lineHeight: 1.5, marginTop: 2 }}>{x.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Block>
      <div style={{ marginTop: -6 }}>
        <Link href="/dashboard/pipeline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, textDecoration: 'none' }}>
          {t('Watch it run in the pipeline')} <Icon name="arrow" size={13} />
        </Link>
      </div>
    </div>
  );
}

export default function StepPanel({
  step, hostname, colorFor,
}: { step: Step; hostname: string; colorFor: (pillarId: string) => string }) {
  const t = useT();
  const copy = STEP_COPY[step.key];
  const f = step.facts;
  return (
    <div className="gv-steps-panel" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px 20px 16px', minHeight: 260 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--gv-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={copy.icon} size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...EYEBROW, color: 'var(--gv-faint)' }}>{t('Step {n} of 6', { n: step.n })}</div>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--gv-ink)', marginTop: 2, letterSpacing: '-0.01em' }}>{t(copy.title)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.55, marginTop: 4, maxWidth: 640 }}>{t(copy.does)}</div>
        </div>
      </div>
      {!f && <Pending step={step} t={t} />}
      {f?.kind === 'business' && <BusinessPanel f={f} t={t} hostname={hostname} />}
      {f?.kind === 'customers' && <CustomersPanel f={f} t={t} />}
      {f?.kind === 'brainstorm' && <BrainstormPanel f={f} t={t} />}
      {f?.kind === 'score' && <ScorePanel f={f} t={t} colorFor={colorFor} />}
      {f?.kind === 'cluster' && <ClusterPanel f={f} t={t} colorFor={colorFor} />}
      {f?.kind === 'schedule' && <SchedulePanel f={f} t={t} state={step.state} />}
    </div>
  );
}
