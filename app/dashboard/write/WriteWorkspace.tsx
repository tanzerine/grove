'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '../gv-icons';
import WriteDesk from './WriteDesk';

const ACCENT = '#63c281';

type Mode = 'blank' | 'idea' | 'seo';
const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: 'blank', label: 'Blank page', icon: 'write' },
  { key: 'idea', label: 'Idea studio', icon: 'sparkle' },
  { key: 'seo', label: 'SEO set', icon: 'rankings' },
];

export default function WriteWorkspace({ domainId, hostname }: { domainId: string; hostname: string }) {
  const r = useRouter();
  const [mode, setMode] = useState<Mode>('blank');

  // blank composer — held locally; a draft is only created on save.
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = !!(title.trim() || bodyText.trim());
  const words = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;

  async function saveDraft() {
    if (!canSave || saving) return;
    setSaving(true);
    const res = await fetch('/api/posts/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, title: title.trim() || undefined, body_md: bodyText }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) { r.push(`/dashboard/posts/${j.id}`); return; }
    setSaving(false);
  }

  return (
    <div className="gv-write-grid" style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 24, alignItems: 'start', marginTop: 6 }}>
      {/* local left sidebar */}
      <aside style={{ position: 'sticky', top: 78, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#565a53', padding: '4px 12px 8px' }}>New post</div>
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <button key={m.key} onClick={() => setMode(m.key)} className="gv-nav"
              style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                border: `1px solid ${on ? 'rgba(99,194,129,0.22)' : 'transparent'}`,
                background: on ? 'rgba(99,194,129,0.1)' : 'transparent',
                color: on ? '#eef1ea' : '#9aa096',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 500, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
              }}>
              <span className="gv-ico" style={{ color: on ? ACCENT : '#6b6f67', display: 'flex', flexShrink: 0 }}><Icon name={m.icon} size={16} /></span>
              <span style={{ flex: 1 }}>{m.label}</span>
            </button>
          );
        })}
      </aside>

      {/* main content */}
      <div style={{ minWidth: 0 }}>
        {mode === 'blank' && (
          <div style={{ maxWidth: 820 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled draft"
              className="gv-title"
              style={{ width: '100%', background: 'transparent', border: 'none', fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 38, lineHeight: 1.14, letterSpacing: '-0.01em', color: '#eef1ea', padding: 0, margin: '0 0 18px', outline: 'none' }}
            />
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveDraft(); } }}
              placeholder="Start writing… formatting and grove assist open once you save."
              className="gv-prompt gv-scroll"
              style={{ width: '100%', minHeight: '52vh', resize: 'vertical', background: '#0d100c', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 18, padding: '32px 40px', color: '#cdd2c9', fontFamily: "'Newsreader', Georgia, serif", fontSize: 19, lineHeight: 1.8, outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <span style={{ fontSize: 12, color: '#6b6f67' }}>{words ? `${words} word${words === 1 ? '' : 's'}` : 'Nothing saved yet'}</span>
              <button onClick={saveDraft} disabled={!canSave || saving} className="gv-btn"
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: ACCENT, color: '#06120b', opacity: canSave ? 1 : 0.45, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, cursor: canSave ? 'pointer' : 'default' }}>
                {saving ? 'Saving…' : <>Save draft <span style={{ display: 'flex' }}><Icon name="send" size={14} /></span></>}
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#565a53', marginTop: 10 }}>A draft is created only when you save — nothing is stored until then.</p>
          </div>
        )}

        {mode === 'idea' && <WriteDesk domainId={domainId} hostname={hostname} mode="idea" />}
        {mode === 'seo' && <WriteDesk domainId={domainId} hostname={hostname} mode="seo" />}
      </div>
    </div>
  );
}
