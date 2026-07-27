'use client';
/**
 * Step 2 · copy-paste embeds — Full blog / Widget tab switcher with one
 * shared preview + snippet panel below (Grove Embed .dc comp). Both
 * snippets are computed server-side and just handed in as props.
 */
import { useState } from 'react';
import CopySnippet from './CopySnippet';
import Icon from '../gv-icons';

type Tab = 'full' | 'widget';

const TABS: { key: Tab; label: string; desc: string; note: string }[] = [
  {
    key: 'full', label: 'Full blog',
    desc: 'The whole blog, live inside /blog — search, filters, pagination, in-page reading. No code to maintain.',
    note: "Visitors read in-page, so this alone won't get indexed — your subdomain from step 1 carries the SEO.",
  },
  {
    key: 'widget', label: 'Homepage widget',
    desc: 'A small teaser for your homepage: latest 3–4 posts and a "Read the blog →" link.',
    note: 'Set data-blog-url to wherever you mounted the full embed, or your subdomain from step 1.',
  },
];

function ImagePlaceholder({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)' }}>
      <Icon name="image" size={size} />
    </div>
  );
}

function FullBlogPreview() {
  const tags = ['All', 'SEO', 'Product', 'Growth'];
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {tags.map((t, i) => (
          <span key={t} style={{ fontSize: 10.5, color: i === 0 ? '#12160a' : 'var(--gv-dim)', background: i === 0 ? 'var(--gv-accent)' : 'rgba(255,255,255,0.05)', border: `1px solid ${i === 0 ? 'var(--gv-accent)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 999, padding: '4px 10px' }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, padding: 12, border: '1px dashed rgba(255,255,255,0.16)', borderRadius: 10, marginBottom: 12 }}>
        <div style={{ width: 120, height: 74, flexShrink: 0, border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 8 }}><ImagePlaceholder /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#eef0ea', lineHeight: 1.3, marginBottom: 4 }}>Your latest post title lands here</div>
          <div style={{ fontSize: 10.5, color: 'var(--gv-faint)' }}>Featured · just now</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div style={{ height: 56, border: '1px dashed rgba(255,255,255,0.16)', borderRadius: 7, marginBottom: 6 }}><ImagePlaceholder size={16} /></div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gv-soft)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Another recent article</div>
            <div style={{ fontSize: 10, color: 'var(--gv-fainter)', marginTop: 2 }}>this week</div>
          </div>
        ))}
      </div>
    </>
  );
}

function WidgetPreview() {
  return (
    <div style={{ position: 'relative', background: '#0d0e0b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 16px', maxWidth: 340 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Blog</span>
        <span style={{ fontSize: 10.5, color: 'var(--gv-dim)' }}>Read the blog →</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <div style={{ width: 42, height: 32, flexShrink: 0, border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 6 }}><ImagePlaceholder size={14} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, color: 'var(--gv-fainter)', marginBottom: 3 }}>{i} day{i === 1 ? '' : 's'} ago</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#eef0ea', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230 }}>A recent post shows up here</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EmbedTabs({ blogSnippet, widgetSnippet, domainId }: { blogSnippet: string; widgetSnippet: string; domainId?: string | null }) {
  const [tab, setTab] = useState<Tab>('full');
  const def = TABS.find((t) => t.key === tab) ?? TABS[0];
  const snippet = tab === 'full' ? blogSnippet : widgetSnippet;

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>Step 2 · Show posts in your site</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Copy-paste embeds</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'}`, background: active ? 'rgba(255,255,255,0.07)' : 'transparent', color: active ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', transition: '.2s' }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 6px' }}>{def.desc}</p>
      <p style={{ fontSize: 12, color: 'var(--gv-fainter)', lineHeight: 1.5, margin: '0 0 16px' }}>{def.note}</p>

      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, background: '#111310', marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 14 }}>Preview — {tab === 'full' ? '/blog page' : 'homepage teaser'}</div>
        {tab === 'full' ? <FullBlogPreview /> : <WidgetPreview />}
      </div>

      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, color: 'var(--gv-faint)', fontFamily: "'SF Mono', ui-monospace, monospace" }}>snippet</span>
          <CopySnippet
            snippet={snippet}
            mode={tab === 'full' ? 'blog' : 'widget'}
            domainId={domainId ?? undefined}
          />
        </div>
        <pre style={{ margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0d0e0b' }}>{snippet}</pre>
      </div>
    </div>
  );
}
