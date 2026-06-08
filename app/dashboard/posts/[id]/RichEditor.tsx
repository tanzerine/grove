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

type Props = {
  postId: string;
  initialBody: string;            // markdown
  initialMetaTitle: string;
  initialMetaDesc: string;
  canEdit: boolean;
};

function getMd(editor: any): string {
  return editor?.storage?.markdown?.getMarkdown?.() ?? '';
}

export default function RichEditor({ postId, initialBody, initialMetaTitle, initialMetaDesc, canEdit }: Props) {
  const r = useRouter();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState(initialMetaTitle);
  const [metaDesc, setMetaDesc] = useState(initialMetaDesc);
  const baseline = useRef<string>(initialBody);

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
    content: initialBody,                 // tiptap-markdown parses markdown content
    onCreate: ({ editor }) => { baseline.current = getMd(editor); },
    onUpdate: ({ editor }) => { setDirty(getMd(editor) !== baseline.current); },
    editorProps: {
      attributes: { class: 'prose', style: 'outline:none; max-width:none;' },
    },
  });

  useEffect(() => { editor?.setEditable(editing); }, [editing, editor]);

  const metaDirty = metaTitle !== initialMetaTitle || metaDesc !== initialMetaDesc;

  async function save() {
    if (!editor) return;
    setSaving(true);
    const md = getMd(editor);
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body_md: md, meta_title: metaTitle, meta_description: metaDesc }),
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

  const wordCount = getMd(editor).trim().split(/\s+/).filter(Boolean).length;

  return (
    <div style={{ marginTop: 16 }}>
      {/* status / hint bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, minHeight: 24 }}>
        {canEdit && !editing && (
          <button onClick={enterEdit} style={hintBtn}>✎ Click the article to edit</button>
        )}
        {editing && (
          <>
            <span style={{ fontSize: 12, color: 'var(--moss)', fontWeight: 600 }}>Editing</span>
            {(dirty || metaDirty) && <span style={{ fontSize: 11, color: '#E0A040' }}>● unsaved</span>}
            {saved && <span style={{ fontSize: 11, color: 'var(--moss)' }}>✓ saved</span>}
            <button onClick={done} disabled={saving} className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>
              {saving ? 'Saving…' : (dirty || metaDirty) ? 'Save & done' : 'Done'}
            </button>
          </>
        )}
        {!editing && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--clay)' }}>{wordCount.toLocaleString()} words</span>}
      </div>

      {/* selection formatting menu (also the future home of "Revise with AI") */}
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
          <div style={bubbleBar}>
            <FmtBtn on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>B</FmtBtn>
            <FmtBtn on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} italic>i</FmtBtn>
            <FmtBtn on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</FmtBtn>
            <FmtBtn on={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</FmtBtn>
            <FmtBtn on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</FmtBtn>
            <FmtBtn on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</FmtBtn>
            <FmtBtn on={editor.isActive('link')} onClick={setLink}>link</FmtBtn>
          </div>
        </BubbleMenu>
      )}

      {/* the single rendered block — reads like the article, editable on click */}
      <div
        onClick={enterEdit}
        style={{
          background: 'white', border: `1px solid ${editing ? 'var(--moss)' : 'var(--line)'}`,
          borderRadius: 14, padding: '36px 44px', transition: 'border-color .15s',
          cursor: canEdit && !editing ? 'text' : 'default',
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* compact SEO panel (kept from the old editor) */}
      {canEdit && (
        <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'white', overflow: 'hidden' }}>
          <button onClick={() => setSeoOpen(o => !o)} style={{ ...hintBtn, width: '100%', padding: '12px 18px', justifyContent: 'flex-start', gap: 8, display: 'flex' }}>
            <span>{seoOpen ? '▾' : '▸'}</span> SEO meta {metaDirty && <span style={{ color: '#E0A040', fontSize: 11 }}>● unsaved</span>}
          </button>
          {seoOpen && (
            <div style={{ padding: 18, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={lbl}>Meta title <span style={{ color: metaTitle.length > 60 ? '#c33' : 'var(--clay)' }}>({metaTitle.length}/60)</span></label>
              <input value={metaTitle} onChange={e => setMetaTitle(e.target.value)} maxLength={80} style={inp} />
              <label style={lbl}>Meta description <span style={{ color: metaDesc.length > 155 ? '#c33' : 'var(--clay)' }}>({metaDesc.length}/155)</span></label>
              <textarea value={metaDesc} onChange={e => setMetaDesc(e.target.value)} maxLength={160} rows={3} style={inp} />
              <button onClick={save} disabled={saving || !metaDirty} className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
                {saving ? 'Saving…' : 'Save meta'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FmtBtn({ children, on, onClick, italic }: { children: React.ReactNode; on?: boolean; onClick: () => void; italic?: boolean }) {
  return (
    <button onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        background: on ? 'var(--moss)' : 'transparent', color: on ? 'white' : 'var(--ink)',
        border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
        fontSize: 13, fontStyle: italic ? 'italic' : 'normal', fontFamily: 'inherit', minWidth: 26,
      }}>
      {children}
    </button>
  );
}

const hintBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--moss)', fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit', padding: 0,
};
const bubbleBar: React.CSSProperties = {
  display: 'flex', gap: 2, background: 'var(--ink)', borderRadius: 8, padding: 4,
  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
};
const lbl: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--clay)', textTransform: 'uppercase', letterSpacing: '0.06em',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', resize: 'vertical',
};
