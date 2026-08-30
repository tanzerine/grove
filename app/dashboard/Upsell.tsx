'use client';
/**
 * The paywall tease. Free / lapsed accounts can walk the whole dashboard, but
 * the moment they trigger a cost-bearing action a feature button calls
 * `gate(feature)` — entitled users sail through, everyone else gets a slick
 * upsell sheet that routes to billing. The backend 402s these same actions
 * independently, so this layer is UX only: it turns a silent failed request
 * into a reason to upgrade.
 *
 * Usage in any client trigger:
 *   const { gate } = useUpsell();
 *   async function run() { if (!gate('generate')) return; ...fetch... }
 */
import { createContext, useContext, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChrome } from './chrome-context';
import Icon from './gv-icons';
import { useT } from './i18n';
import { msg } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/** What the reader was reaching for → the pitch they see. Keys are stable
 *  short slugs the trigger passes; unknown keys fall back to a generic pitch. */
type Feature =
  | 'generate' | 'write' | 'pseo' | 'assistant' | 'retry' | 'revise' | 'publish';

/** English source copy. Translated at the render site (t(copy.eyebrow) etc.)
 *  rather than here: this is module-level, so `t` is not in scope, and baking
 *  a locale in at import time would freeze it for the whole process. */
const COPY: Record<Feature, { eyebrow: string; title: string; body: string }> = {
  generate: {
    eyebrow: msg('Autopilot is a paid feature'),
    title: msg('Let grove research, write & publish this for you'),
    body: msg('Your plan runs the full pipeline — live SERP research, on-brand drafting, a quality gate, and auto-publish to your blog. Start a plan to queue this topic.'),
  },
  write: {
    eyebrow: msg('The writing desk is a paid feature'),
    title: msg('Turn any idea into a finished, SEO-ready post'),
    body: msg('grove drafts in your voice, adds internal links, and holds the result for your sign-off. Pick a plan to write your first one.'),
  },
  pseo: {
    eyebrow: msg('Programmatic SEO is a paid feature'),
    title: msg('Ship one page per real search, at scale'),
    body: msg('grove plans a keyword set from live search demand and generates a page for each. Start a plan to build the set.'),
  },
  assistant: {
    eyebrow: msg('The agent is a paid feature'),
    title: msg('Put your marketing agent to work'),
    body: msg('Ask it to fix weak titles, build content clusters, or explain your numbers — and it executes. Start a plan to hand it the reins.'),
  },
  retry: {
    eyebrow: msg('Generation is a paid feature'),
    title: msg('Re-run this draft through the pipeline'),
    body: msg('Retrying re-researches and re-writes with fresh SERP data. Start a plan to run it.'),
  },
  revise: {
    eyebrow: msg('AI editing is a paid feature'),
    title: msg('Rewrite any section in one click'),
    body: msg('grove revises the passage in your brand voice while keeping the rest intact. Start a plan to edit with AI.'),
  },
  publish: {
    eyebrow: msg('Publishing is a paid feature'),
    title: msg('Push this live to your blog'),
    body: msg('Publishing sends the post to your hosted blog and cross-posts the social variants. Start a plan to go live.'),
  },
};

type UpsellApi = {
  entitled: boolean;
  /** Returns true if the user may proceed. Otherwise opens the sheet and
   *  returns false — call it at the top of any gated handler. */
  gate: (feature?: Feature) => boolean;
  /** Force the sheet open (e.g. a locked ghost card was clicked). */
  open: (feature?: Feature) => void;
};

const Ctx = createContext<UpsellApi | null>(null);

export function useUpsell(): UpsellApi {
  return useContext(Ctx) ?? { entitled: false, gate: () => false, open: () => {} };
}

export function UpsellProvider({ children }: { children: React.ReactNode }) {
  const { entitled } = useChrome();
  const r = useRouter();
  const [feature, setFeature] = useState<Feature | null>(null);

  const open = useCallback((f: Feature = 'generate') => setFeature(f), []);
  const gate = useCallback(
    (f: Feature = 'generate') => {
      if (entitled) return true;
      setFeature(f);
      return false;
    },
    [entitled],
  );

  const t = useT();
  const copy = feature ? COPY[feature] : null;

  return (
    <Ctx.Provider value={{ entitled, gate, open }}>
      {children}
      {copy && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setFeature(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'gvFade 0.14s ease-out' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 20, padding: '26px 26px 22px', boxShadow: '0 24px 70px rgba(255,255,255,0.28)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT_INK, fontWeight: 700 }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(162,255,1,0.14)', border: '1px solid rgba(162,255,1,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="leaf" size={13} />
                </span>
                {t(copy.eyebrow)}
              </span>
              <button onClick={() => setFeature(null)} aria-label={t(t('Close'))} style={{ background: 'none', border: 'none', color: 'var(--gv-faint)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25, margin: '0 0 10px', color: 'var(--gv-ink)' }}>{t(copy.title)}</h2>
            <p style={{ fontSize: 13.5, color: 'var(--gv-soft)', lineHeight: 1.6, margin: '0 0 22px' }}>{t(copy.body)}</p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setFeature(null); r.push('/dashboard/billing'); }}
                style={{ flex: 1, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '12px 18px', borderRadius: 11, cursor: 'pointer' }}
              >
                {t(t('See plans →'))}
              </button>
              <button
                onClick={() => setFeature(null)}
                style={{ border: '1px solid var(--gv-line)', background: 'transparent', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, padding: '12px 18px', borderRadius: 11, cursor: 'pointer' }}
              >
                {t(t('Not now'))}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', textAlign: 'center', marginTop: 14 }}>
              Plans from ${' '}
              <span style={{ color: 'var(--gv-soft)', fontWeight: 600 }}>29/mo</span> · cancel anytime
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
