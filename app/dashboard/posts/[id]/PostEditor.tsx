'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  postId: string;
  initialBody: string;
  initialMetaTitle: string;
  initialMetaDesc: string;
  status: string;
};

type Tab = 'article' | 'seo';

export default function PostEditor({ postId, initialBody, initialMetaTitle, initialMetaDesc, status }: Props) {
  const r = useRouter();
  const [tab, setTab] = useState<Tab>('article');
  const [body, setBody] = useState(initialBody);
  const [metaTitle, setMetaTitle] = useState(initialMetaTitle);
  const [metaDesc, setMetaDesc] = useState(initialMetaDesc);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const dirty = body !== initialBody || metaTitle !== initialMetaTitle || metaDesc !== initialMetaDesc;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body_md: body, meta_title: metaTitle, meta_description: metaDesc }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      r.refresh();
    }
  }

  // Toolbar helpers — insert markdown at cursor
  function wrap(before: string, after = before) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = body.slice(start, end);
    const next = body.slice(0, start) + before + sel + after + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  }

  function insertLine(prefix: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next);
    setTimeout(() => ta.focus(), 0);
  }

  return (
    <div style={{ marginTop: 32 }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '14px 20px', background: 'white', border: '1px solid var(--line)',
          borderRadius: open ? '12px 12px 0 0' : 12, cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left', transition: 'border-radius .15s',
        }}
      >
        <span style={{ fontSize: 16 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'Clash Display', fontSize: 16, fontWeight: 600 }}>Edit post</span>
        {dirty && !saving && <span style={{ fontSize: 11, color: '#E0A040', marginLeft: 4 }}>● unsaved</span>}
        {saved && <span style={{ fontSize: 11, color: 'var(--moss)', marginLeft: 4 }}>✓ saved</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--clay)' }}>{wordCount.toLocaleString()} words</span>
      </button>

      {open && (
        <div style={{ border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 12px 12px', background: 'white', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
            {(['article', 'seo'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '10px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--ink)' : 'var(--clay)',
                  background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--moss)' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                }}
              >
                {t === 'article' ? 'Article body' : 'SEO meta'}
              </button>
            ))}
          </div>

          {tab === 'article' && (
            <>
              {/* Markdown toolbar */}
              <div style={{ display: 'flex', gap: 2, padding: '8px 12px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                {[
                  { label: 'B', title: 'Bold', action: () => wrap('**') },
                  { label: 'I', title: 'Italic', action: () => wrap('*') },
                  { label: 'H2', title: 'Heading 2', action: () => insertLine('## ') },
                  { label: 'H3', title: 'Heading 3', action: () => insertLine('### ') },
                  { label: '— quote', title: 'Blockquote', action: () => insertLine('> ') },
                  { label: '• list', title: 'Bullet list', action: () => insertLine('- ') },
                  { label: '1. list', title: 'Numbered list', action: () => insertLine('1. ') },
                  { label: '`code`', title: 'Inline code', action: () => wrap('`') },
                  { label: '---', title: 'Horizontal rule', action: () => setBody(b => b + '\n\n---\n\n') },
                ].map(btn => (
                  <button
                    key={btn.label}
                    title={btn.title}
                    onClick={btn.action}
                    style={{
                      padding: '4px 9px', fontSize: 12, fontFamily: 'monospace',
                      background: 'var(--paper)', border: '1px solid var(--line)',
                      borderRadius: 6, cursor: 'pointer', color: 'var(--ink)',
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                style={{
                  width: '100%', minHeight: 520, padding: '20px 24px',
                  fontFamily: '"JetBrains Mono", "Fira Mono", ui-monospace, monospace',
                  fontSize: 13.5, lineHeight: 1.75, resize: 'vertical',
                  border: 'none', outline: 'none', boxSizing: 'border-box',
                  color: 'var(--ink)', background: 'white',
                }}
                spellCheck
              />
            </>
          )}

          {tab === 'seo' && (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--clay)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Meta title <span style={{ color: metaTitle.length > 60 ? '#c33' : 'var(--clay)' }}>({metaTitle.length}/60)</span>
                </label>
                <input
                  value={metaTitle}
                  onChange={e => setMetaTitle(e.target.value)}
                  maxLength={80}
                  style={{
                    width: '100%', padding: '10px 14px', border: '1px solid var(--line)',
                    borderRadius: 8, fontSize: 14, fontFamily: 'inherit',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--clay)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Meta description <span style={{ color: metaDesc.length > 155 ? '#c33' : 'var(--clay)' }}>({metaDesc.length}/155)</span>
                </label>
                <textarea
                  value={metaDesc}
                  onChange={e => setMetaDesc(e.target.value)}
                  maxLength={160}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 14px', border: '1px solid var(--line)',
                    borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              {/* Google preview */}
              <div style={{ padding: 16, background: 'var(--paper)', borderRadius: 10, fontSize: 13 }}>
                <div style={{ fontSize: 11, color: 'var(--clay)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Google preview</div>
                <div style={{ color: '#1a0dab', fontSize: 17, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{metaTitle || '(no title)'}</div>
                <div style={{ color: '#006621', fontSize: 13, marginBottom: 3 }}>www.yourdomain.com › blog › …</div>
                <div style={{ color: '#545454', fontSize: 13, lineHeight: 1.5 }}>{metaDesc || '(no description)'}</div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
            borderTop: '1px solid var(--line)', background: 'var(--paper)',
          }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setBody(initialBody); setMetaTitle(initialMetaTitle); setMetaDesc(initialMetaDesc); }}
              disabled={saving || !dirty}
            >
              Discard
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--clay)' }}>
              {wordCount.toLocaleString()} words · {body.length.toLocaleString()} chars
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
