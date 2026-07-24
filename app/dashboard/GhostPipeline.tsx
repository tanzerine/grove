'use client';
/**
 * The tease for Free / lapsed accounts. Topic suggestions are free & ungated
 * (`/api/topics/suggest`), so we show real, personalized article ideas for the
 * user's own domain rendered as locked "draft" cards — the pipeline they'd get
 * if they upgraded. Every interaction routes to the upsell sheet → billing.
 * Nothing here spends LLM credits.
 */
import { useEffect, useState } from 'react';
import Icon from './gv-icons';
import { useUpsell } from './Upsell';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

// Shown while the real suggestions load — and as a fallback if the profile is
// too thin to suggest from, so the tease never renders empty.
const FALLBACK = [
  'The founder’s guide to shipping content on autopilot',
  '5 mistakes teams make with their blog (and how to fix them)',
  'How we turned search demand into a publishing calendar',
  'The honest breakdown: build vs. buy for content',
];

// Deterministic-ish "stage" labels so the ghost queue reads like a live one.
const STAGES = ['Researching', 'Drafting', 'Quality gate', 'Ready to publish'];

export default function GhostPipeline({ domainId, hostname }: { domainId?: string; hostname: string }) {
  const { open } = useUpsell();
  const [ideas, setIdeas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!domainId) throw new Error('no domain');
        const res = await fetch(`/api/topics/suggest?domain_id=${domainId}`);
        const j = await res.json().catch(() => ({}));
        const s: string[] = j.suggestions ?? [];
        if (alive) setIdeas(s.length ? s.slice(0, 4) : FALLBACK);
      } catch {
        if (alive) setIdeas(FALLBACK);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [domainId]);

  const rows = loading ? new Array(4).fill(null) : ideas;

  return (
    <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Grove is ready to write for {hostname}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, color: ACCENT_INK, background: 'rgba(162,255,1,0.14)', border: '1px solid rgba(162,255,1,0.35)', borderRadius: 6, padding: '3px 8px' }}>
              <Icon name="lock" size={11} />Preview
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 4 }}>
            These are real topics grove found for your site. Start a plan and it researches, drafts &amp; publishes them for you.
          </div>
        </div>
        <button
          onClick={() => open('generate')}
          style={{ border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Unlock autopilot →
        </button>
      </div>

      {/* ghost queue */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {rows.map((idea: string | null, i: number) => (
          <button
            key={i}
            onClick={() => open('generate')}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', padding: '13px 15px', borderRadius: 12, background: 'rgba(15,23,18,0.02)', border: '1px solid var(--gv-line)', cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(15,23,18,0.04)', border: '1px solid var(--gv-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gv-dim)', flexShrink: 0 }}>
              <Icon name="doc" size={15} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {loading ? (
                <span style={{ display: 'block', height: 13, width: `${70 - i * 8}%`, background: 'rgba(15,23,18,0.07)', borderRadius: 5 }} />
              ) : (
                <>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{idea}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--gv-faint)', marginTop: 2 }}>{STAGES[i % STAGES.length]} · locked</span>
                </>
              )}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--gv-dim)', flexShrink: 0 }}>
              <Icon name="lock" size={13} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
