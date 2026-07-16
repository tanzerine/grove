'use client';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stripLeadingH1, withTitleH1 } from '@/lib/article-body';
import Icon from '../../gv-icons';

const ACCENT = 'var(--gv-accent)';

type Props = {
  postId: string | null;         // null = a brand-new blank draft, created on first save
  domainId?: string;             // required when postId is null (to create the draft)
  initialBody: string;            // markdown
  initialTitle: string;
  initialMetaTitle: string;
  initialMetaDesc: string;
  canEdit: boolean;
  autoEdit?: boolean;             // open straight into edit mode (fresh manual drafts)
  railExtra?: React.ReactNode;   // extra card pinned to the top of the assist rail
  belowCanvas?: React.ReactNode; // rendered under the SEO panel, inside the article column
};

// A grove-assist request + its result, rendered in the right rail feed.
type AssistCard = {
  id: string;
  label: string;                  // the instruction / chip
  status: 'thinking' | 'pending' | 'applied' | 'dismissed' | 'error';
  original?: string;
  suggested?: string;
  from?: number;
  to?: number;
  error?: string;
};

const CHIPS = ['Make it punchier', 'Add a supporting stat', 'Simplify', 'Match my voice', 'Tighten this'];

function getMd(editor: any): string {
  return editor?.storage?.markdown?.getMarkdown?.() ?? '';
}

export default function RichEditor({ postId, domainId, initialBody, initialTitle, initialMetaTitle, initialMetaDesc, canEdit, autoEdit, railExtra, belowCanvas }: Props) {
  const r = useRouter();
  const [editing, setEditing] = useState(!!autoEdit);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [seoOpen, setSeoOpen] = useState(!!autoEdit);   // show the title field first on a fresh draft
  const [title, setTitle] = useState(initialTitle);
  const [metaTitle, setMetaTitle] = useState(initialMetaTitle);
  const [metaDesc, setMetaDesc] = useState(initialMetaDesc);
  const [prompt, setPrompt] = useState('');
  const [cards, setCards] = useState<AssistCard[]>([]);
  const baseline = useRef<string>(initialBody);
  const lastInitialBody = useRef<string>(initialBody);
  const promptRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const cid = useRef(1);

  const editor = useEditor({
    immediatelyRender: false,            // required for Next SSR (no hydration mismatch)
    editable: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    // The title renders as the canvas's own first line, so the body's stored
    // leading `# Title` is stripped here and re-attached on save.
    content: stripLeadingH1(initialBody), // tiptap-markdown parses markdown content
    onCreate: ({ editor }) => { baseline.current = getMd(editor); },
    onUpdate: ({ editor }) => { setDirty(getMd(editor) !== baseline.current); },
    editorProps: {
      attributes: { class: 'prose', style: 'outline:none; max-width:none;' },
    },
  });

  useEffect(() => { editor?.setEditable(editing); }, [editing, editor]);

  // Re-sync the canvas when the server sends new body markdown (e.g. after
  // generating a cover / inline images, which inject an image into body_md and
  // then r.refresh()). Without this, tiptap keeps the content it was created
  // with and the new image never appears. Only sync when the prop actually
  // changed and the author isn't mid-edit, so we never clobber unsaved work.
  useEffect(() => {
    if (!editor) return;
    if (initialBody === lastInitialBody.current) return;
    lastInitialBody.current = initialBody;
    if (editing || dirty) return;
    editor.commands.setContent(stripLeadingH1(initialBody));
    baseline.current = getMd(editor);
    setDirty(false);
  }, [initialBody, editor, editing, dirty]);

  // Fresh manual drafts land in edit mode — drop the cursor where writing
  // starts: the title if it's still blank, otherwise the end of the body.
  useEffect(() => {
    if (!autoEdit || !editor) return;
    setTimeout(() => {
      if (!initialTitle && titleRef.current) titleRef.current.focus();
      else editor.commands.focus('end');
    }, 0);
  }, [autoEdit, editor, initialTitle]);

  // The in-canvas title is a textarea so long titles wrap like the rendered
  // article; keep its height matched to its content. Re-measure once webfonts
  // land and on resize — both change how many lines the title wraps to.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [title]);

  const metaDirty = title !== initialTitle || metaTitle !== initialMetaTitle || metaDesc !== initialMetaDesc;

  async function save() {
    if (!editor) return;
    setSaving(true);
    const md = getMd(editor);
    // Stored bodies keep the title as their leading H1 (validator, manager
    // rubric and cover injection all anchor on it) — re-attach it here so the
    // H1 also follows title edits instead of drifting.
    const storedMd = withTitleH1(title, md);
    // Brand-new blank draft: create it now, then continue in the editor route.
    if (postId == null) {
      const res = await fetch('/api/posts/manual', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, title: title.trim() || undefined, body_md: storedMd }),
      });
      const j = await res.json().catch(() => ({}));
      setSaving(false);
      if (res.ok && j.id) { baseline.current = md; setDirty(false); r.push(`/dashboard/posts/${j.id}`); }
      return;
    }
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body_md: storedMd, meta_title: metaTitle, meta_description: metaDesc }),
    });
    setSaving(false);
    if (res.ok) {
      baseline.current = md;
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      r.refresh();
    }
  }

  async function done() {
    if (dirty || metaDirty) await save();
    setEditing(false);
  }

  function discard() {
    if (!editor) return;
    if ((dirty || metaDirty) && !confirm('Discard your changes since the last save?')) return;
    editor.commands.setContent(baseline.current);   // baseline is the last-saved markdown
    setTitle(initialTitle);
    setMetaTitle(initialMetaTitle);
    setMetaDesc(initialMetaDesc);
    setDirty(false);
    setEditing(false);
  }

  function enterEdit() {
    if (!canEdit || editing) return;
    setEditing(true);
    setTimeout(() => editor?.commands.focus(), 0);
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  }

  // ── grove assist: revise the selected passage, surfaced in the rail feed ──
  function pushCard(c: AssistCard) { setCards((cs) => [c, ...cs]); }
  function patchCard(id: string, patch: Partial<AssistCard>) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function askGrove(instruction: string) {
    if (!editor) return;
    const id = 'a' + (cid.current++);
    if (postId == null) {
      pushCard({ id, label: instruction, status: 'error', error: 'Save this draft first — then grove assist can revise a selection.' });
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      pushCard({ id, label: instruction, status: 'error', error: 'Select a passage in the draft, then ask grove to revise it.' });
      return;
    }
    const text = editor.state.doc.textBetween(from, to, ' ');
    if (text.trim().length < 2) {
      pushCard({ id, label: instruction, status: 'error', error: 'Select a longer passage to revise.' });
      return;
    }
    pushCard({ id, label: instruction, status: 'thinking', original: text, from, to });
    try {
      const res = await fetch(`/api/posts/${postId}/revise-section`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected: text, instruction, context: getMd(editor) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.revised) { patchCard(id, { status: 'error', error: j.error ?? 'revision failed' }); return; }
      patchCard(id, { status: 'pending', suggested: j.revised });
    } catch (e: any) {
      patchCard(id, { status: 'error', error: String(e?.message ?? e) });
    }
  }

  function applyCard(c: AssistCard) {
    if (!editor || c.from == null || c.to == null || !c.suggested) return;
    if (!editing) setEditing(true);
    editor.setEditable(true);
    // replace exactly the originally-selected range with the revision
    editor.chain().focus().setTextSelection({ from: c.from, to: c.to }).insertContent(c.suggested).run();
    setDirty(getMd(editor) !== baseline.current);
    // Applying shifts document positions, so other open suggestions' stored
    // ranges are no longer reliable — retire them rather than risk a bad insert.
    setCards((cs) => cs.map((x) =>
      x.id === c.id ? { ...x, status: 'applied' }
        : (x.status === 'pending' || x.status === 'thinking') ? { ...x, status: 'dismissed' }
        : x));
  }
  function dismissCard(id: string) { patchCard(id, { status: 'dismissed' }); }

  function submitPrompt() {
    const t = prompt.trim();
    if (!t) return;
    askGrove(t);
    setPrompt('');
  }

  const wordCount = getMd(editor).trim().split(/\s+/).filter(Boolean).length;
  const pendingCount = cards.filter((c) => c.status === 'pending').length;
  const showRail = canEdit && !focusMode;

  return (
    <div>
      {/* editor control bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, minHeight: 26, flexWrap: 'wrap' }}>
        {canEdit && !editing && (
          <button onClick={enterEdit} className="gv-tool" style={hintBtn}>✎ Click the article to edit</button>
        )}
        {editing && (
          <>
            <span style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>Editing</span>
            {(dirty || metaDirty) && <span style={{ fontSize: 11, color: 'var(--gv-amber)' }}>● unsaved</span>}
            {saved && <span style={{ fontSize: 11, color: ACCENT }}>✓ saved</span>}
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', fontVariantNumeric: 'tabular-nums' }}>{wordCount.toLocaleString()} words · {Math.max(1, Math.round(wordCount / 230))} min read</span>
        {canEdit && (
          <button onClick={() => setFocusMode((f) => !f)} className="gv-ghost" style={ghostBtn}>
            {focusMode ? 'Exit focus' : 'Focus'}
          </button>
        )}
        {editing ? (
          <>
            <button onClick={done} disabled={saving} className="gv-btn" style={primaryBtn}>
              <span style={{ display: 'flex' }}><Icon name="check" size={14} /></span>
              {saving ? 'Saving…' : postId == null ? 'Save draft' : (dirty || metaDirty) ? 'Save & done' : 'Done'}
            </button>
            <button onClick={discard} disabled={saving} className="gv-ghost" style={ghostBtn}>Discard</button>
          </>
        ) : canEdit ? (
          <button onClick={enterEdit} className="gv-btn" style={primaryBtn}>Edit draft</button>
        ) : null}
      </div>

      {/* selection formatting menu */}
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
          <div style={bubbleBar}>
            <FmtBtn on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>B</FmtBtn>
            <FmtBtn on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} italic>i</FmtBtn>
            <FmtBtn on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</FmtBtn>
            <FmtBtn on={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</FmtBtn>
            <FmtBtn on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</FmtBtn>
            <FmtBtn on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</FmtBtn>
            <FmtBtn on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</FmtBtn>
            <FmtBtn on={editor.isActive('link')} onClick={setLink}>link</FmtBtn>
            <span style={{ width: 1, background: 'rgba(255,255,255,0.22)', margin: '2px 3px' }} />
            <FmtBtn onClick={() => { promptRef.current?.focus(); }}>✨ AI</FmtBtn>
          </div>
        </BubbleMenu>
      )}

      {/* canvas + assist rail */}
      <div className="gv-2col-rail" style={{ display: 'grid', gridTemplateColumns: showRail ? 'minmax(0,1fr) 360px' : '1fr', gap: 22, alignItems: 'start' }}>

        {/* ── editor column ── */}
        <div style={{ minWidth: 0 }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            {/* persistent formatting toolbar */}
            {canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', marginBottom: 18, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', position: 'sticky', top: 64, zIndex: 10, backdropFilter: 'blur(10px)' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-dim)', padding: '0 8px' }}>Paragraph</span>
                <span style={tbDivider} />
                <ToolBtn on={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} serif>B</ToolBtn>
                <ToolBtn on={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} serif italic>i</ToolBtn>
                <ToolBtn on={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} serif>”</ToolBtn>
                <ToolBtn on={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}><Icon name="pipeline" size={15} /></ToolBtn>
                <ToolBtn on={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</ToolBtn>
                <ToolBtn on={editor?.isActive('link')} onClick={setLink}><Icon name="link" size={15} /></ToolBtn>
                <span style={{ flex: 1 }} />
                <button onClick={() => promptRef.current?.focus()} className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px', borderRadius: 8, border: 'none', background: 'rgba(99,194,129,0.14)', color: ACCENT, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  <Icon name="sparkle" size={13} /> Ask grove
                </button>
              </div>
            )}

            {/* writing canvas — the title is the article's first line, like the rendered post */}
            <div
              className="gv-editor-canvas gv-canvas-prose"
              onClick={enterEdit}
              style={{
                background: '#0d100c',
                border: `1px solid ${editing ? 'rgba(99,194,129,0.4)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 18, padding: '48px 56px 54px', transition: 'border-color .15s',
                cursor: canEdit && !editing ? 'text' : 'default',
              }}
            >
              {canEdit ? (
                <textarea
                  ref={titleRef}
                  className="gv-title gv-canvas-title"
                  value={title}
                  rows={1}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { setTitle(e.target.value); if (!editing) setEditing(true); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enterEdit(); editor?.commands.focus('start'); } }}
                  placeholder="Untitled draft"
                  spellCheck={false}
                  style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', padding: 0 }}
                />
              ) : (
                <h1 className="gv-canvas-title">{title || 'Untitled draft'}</h1>
              )}
              <EditorContent editor={editor} />
            </div>

            {/* compact SEO panel */}
            {canEdit && (
              <>
                <button
                  onClick={() => setSeoOpen((o) => !o)}
                  className="gv-tool"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 14, border: '1px solid rgba(255,255,255,0.07)', background: 'var(--gv-card)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '13px 18px', borderRadius: seoOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ display: 'flex', transform: seoOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .2s' }}><Icon name="chevron" size={14} /></span>
                  Title &amp; SEO
                  {metaDirty && <span style={{ color: 'var(--gv-amber)', fontSize: 11, fontWeight: 500 }}>● unsaved</span>}
                </button>
                {seoOpen && (
                  <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none', borderRadius: '0 0 12px 12px', background: '#0d100c', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <label style={lbl}>Meta title <span style={{ color: metaTitle.length > 60 ? 'var(--gv-red)' : 'var(--gv-dim)' }}>({metaTitle.length}/60)</span></label>
                    <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={80} className="gv-prompt" style={inp} />
                    <label style={lbl}>Meta description <span style={{ color: metaDesc.length > 155 ? 'var(--gv-red)' : 'var(--gv-dim)' }}>({metaDesc.length}/155)</span></label>
                    <textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} maxLength={160} rows={3} className="gv-prompt" style={inp} />
                    <button onClick={save} disabled={saving || !metaDirty} className="gv-btn" style={{ ...primaryBtn, alignSelf: 'flex-start' }}>
                      {saving ? 'Saving…' : 'Save meta'}
                    </button>
                  </div>
                )}
              </>
            )}

            {belowCanvas}
          </div>
        </div>

        {/* ── grove assist rail ── */}
        {showRail && (
          <aside className="gv-rail" style={{ position: 'sticky', top: 78, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {railExtra}
            <div style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(99,194,129,0.2)', borderRadius: 18, padding: '18px 18px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,194,129,0.14)', border: '1px solid rgba(99,194,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT }}><Icon name="sparkle" size={15} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)' }}>grove assist</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gv-dim)' }}>{pendingCount} suggestion{pendingCount === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 8px 8px 14px' }}>
                <input
                  ref={promptRef}
                  className="gv-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPrompt(); } }}
                  placeholder="Select text, then ask grove to revise…"
                  style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 13, minWidth: 0, outline: 'none' }}
                />
                <button onClick={submitPrompt} className="gv-btn" style={{ width: 32, height: 32, flexShrink: 0, border: 'none', borderRadius: 9, background: ACCENT, color: 'var(--gv-on-accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="send" size={16} /></button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
                {CHIPS.map((label) => (
                  <button key={label} onClick={() => askGrove(label)} className="gv-chip" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 999, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
                ))}
              </div>
            </div>

            {/* feed */}
            {cards.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cards.map((c) => {
                  const resolved = c.status === 'applied' || c.status === 'dismissed';
                  return (
                    <div key={c.id} style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 15px', opacity: resolved ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ACCENT, background: 'rgba(99,194,129,0.12)', borderRadius: 5, padding: '3px 7px' }}>Ask grove</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-soft)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                      </div>

                      {c.status === 'thinking' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 2px' }}>
                          <span style={{ display: 'inline-flex', gap: 4 }}><span className="gv-tdot" /><span className="gv-tdot" style={{ animationDelay: '.18s' }} /><span className="gv-tdot" style={{ animationDelay: '.36s' }} /></span>
                          <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>grove is writing…</span>
                        </div>
                      )}

                      {c.status === 'error' && (
                        <div style={{ fontSize: 12, color: 'var(--gv-red)', lineHeight: 1.5 }}>{c.error}</div>
                      )}

                      {c.status === 'pending' && (
                        <div>
                          {c.original && (
                            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 14, lineHeight: 1.5, color: 'var(--gv-faint)', textDecoration: 'line-through', marginBottom: 5 }}>{c.original}</div>
                          )}
                          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 14.5, lineHeight: 1.55, color: '#d4dacd' }}>{c.suggested}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12 }}>
                            <button onClick={() => applyCard(c)} className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}><Icon name="check" size={13} /> Apply</button>
                            <button onClick={() => dismissCard(c.id)} className="gv-ghost" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}>Dismiss</button>
                          </div>
                        </div>
                      )}

                      {resolved && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: c.status === 'applied' ? ACCENT : 'var(--gv-faint)' }}>
                          <span style={{ display: 'flex' }}><Icon name={c.status === 'applied' ? 'check' : 'x'} size={13} /></span>
                          {c.status === 'applied' ? 'Applied to draft' : 'Dismissed'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function FmtBtn({ children, on, onClick, italic }: { children: React.ReactNode; on?: boolean; onClick: () => void; italic?: boolean }) {
  return (
    <button onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        // bar background is dark (var(--gv-pop)); keep text light so it's readable
        background: on ? ACCENT : 'transparent', color: on ? 'var(--gv-on-accent)' : '#fff',
        border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
        fontSize: 13, fontStyle: italic ? 'italic' : 'normal', fontFamily: 'inherit', minWidth: 26,
      }}>
      {children}
    </button>
  );
}

function ToolBtn({ children, on, onClick, serif, italic }: { children: React.ReactNode; on?: boolean; onClick: () => void; serif?: boolean; italic?: boolean }) {
  return (
    <button onMouseDown={(e) => { e.preventDefault(); onClick(); }} className="gv-tool"
      style={{
        width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, border: `1px solid ${on ? 'rgba(99,194,129,0.3)' : 'rgba(255,255,255,0.08)'}`,
        background: on ? 'rgba(99,194,129,0.14)' : 'transparent', color: on ? ACCENT : 'var(--gv-soft)',
        fontFamily: serif ? "'Newsreader', Georgia, serif" : 'inherit', fontStyle: italic ? 'italic' : 'normal',
        fontWeight: serif ? 700 : 500, fontSize: serif ? 15 : 13, lineHeight: 1, cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

const hintBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: ACCENT, fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit', padding: 0,
};
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9, cursor: 'pointer',
};
const tbDivider: React.CSSProperties = { width: 1, height: 18, background: 'rgba(255,255,255,0.08)', margin: '0 2px' };
const bubbleBar: React.CSSProperties = {
  display: 'flex', gap: 2, background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 4,
  boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
};
const lbl: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--gv-dim)', textTransform: 'uppercase', letterSpacing: '0.06em',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', resize: 'vertical',
  color: 'var(--gv-ink)', background: 'rgba(255,255,255,0.04)',
};
