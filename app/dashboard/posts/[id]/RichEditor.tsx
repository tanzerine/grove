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
import { sanitizeAlt } from '@/lib/images/prompt';
import Icon from '../../gv-icons';
import ImageStudio, { type ImageContext } from './ImageStudio';
import { looksLikeImage, uploadImage } from './upload-image';
import SchedulePicker from './SchedulePicker';
import { useT } from '../../i18n';
import { msg } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

type Props = {
  postId: string | null;         // null = a brand-new blank draft, created on first save
  /**
   * The domain the draft belongs to. Not optional — every image path in the
   * editor (generate, upload, drop, paste) is domain-scoped and refuses to run
   * without it, and a `?` here let the post page omit it silently: the whole
   * image tool answered "Add a domain first" on a post that plainly had one.
   * Pass `undefined` explicitly if a caller genuinely has no domain yet.
   */
  domainId: string | undefined;
  initialBody: string;            // markdown
  initialTitle: string;
  initialMetaTitle: string;
  initialMetaDesc: string;
  canEdit: boolean;
  initialScheduledAt?: string | null; // current publish time, if the post has one
  /**
   * Whether that time is a commitment. Only a post whose status is `scheduled`
   * is picked up by the publisher cron; a draft in `review` carries the date
   * its strategy slot planned for it and waits for a human indefinitely. The
   * editor showed both identically, so a gated draft read "due now".
   */
  initialWillPublish?: boolean;
  schedulable?: boolean;          // false for a live post (managed from the post header)
  autoEdit?: boolean;             // open straight into edit mode (fresh manual drafts)
  railExtra?: React.ReactNode;   // extra card pinned to the top of the assist rail
  belowCanvas?: React.ReactNode; // rendered under the SEO panel, inside the article column
  /**
   * Told whenever the canvas gains or loses unsaved work. The Write page uses
   * it to know whether swapping the editor over to a finished draft would throw
   * away something the author typed.
   */
  onDirtyChange?: (dirty: boolean) => void;
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

const CHIPS = [msg('Make it punchier'), msg('Add a supporting stat'), msg('Simplify'), msg('Match my voice'), msg('Tighten this')];

function getMd(editor: any): string {
  return editor?.storage?.markdown?.getMarkdown?.() ?? '';
}

export default function RichEditor({ postId, domainId, initialBody, initialTitle, initialMetaTitle, initialMetaDesc, canEdit, initialScheduledAt = null, initialWillPublish = true, schedulable = true, autoEdit, railExtra, belowCanvas, onDirtyChange }: Props) {
  const t = useT();
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
  const [imageOpen, setImageOpen] = useState(false);
  // Progress for images dropped/pasted straight onto the canvas. The image tool
  // has its own status line; this covers the path that bypasses it.
  const [canvasDrop, setCanvasDrop] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [scheduledAt, setScheduledAt] = useState<string | null>(initialScheduledAt);
  const [willPublish, setWillPublish] = useState(initialWillPublish);
  const baseline = useRef<string>(initialBody);
  const lastInitialBody = useRef<string>(initialBody);
  // Last title/meta the server gave us. This — not the props — is the yardstick
  // for "unsaved" and what Discard reverts to, so new server values (a
  // regenerate) don't light up every field as unsaved.
  const syncedMeta = useRef({ title: initialTitle, metaTitle: initialMetaTitle, metaDesc: initialMetaDesc });
  const promptRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const imageAnchor = useRef<number | null>(null);
  const cid = useRef(1);
  // tiptap builds `editorProps` once, so its handlers would close over the
  // first render's props forever. The ref keeps the drop/paste path pointed at
  // the current one (postId in particular changes when a blank draft is saved).
  const dropRef = useRef<(files: File[], pos: number | null) => void>(() => {});

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
    onUpdate: ({ editor }) => {
      // The canvas is only editable in edit mode, so an update while it ISN'T
      // can't be the author: it's a plugin normalising the doc just after load,
      // or our own re-sync below. Re-baseline instead of flagging it unsaved —
      // a phantom "dirty" here would block every later re-sync (they refuse to
      // clobber unsaved work) and leave a regenerated article invisible.
      if (!editor.isEditable) { baseline.current = getMd(editor); setDirty(false); return; }
      setDirty(getMd(editor) !== baseline.current);
    },
    editorProps: {
      attributes: { class: 'prose', style: 'outline:none; max-width:none;' },
      // Paste a screenshot / drag a file in from the desktop. Both only fire
      // while the canvas is editable, which is the behaviour we want: reading
      // mode shouldn't quietly start uploading things.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(looksLikeImage);
        if (!files.length) return false;   // not an image paste — let tiptap have it
        event.preventDefault();
        dropRef.current(files, null);      // null = insert at the cursor
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;           // dragging a node around inside the doc
        const files = Array.from(event.dataTransfer?.files ?? []).filter(looksLikeImage);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        dropRef.current(files, at);
        return true;
      },
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

  // Same re-sync for the title and meta fields. They're the visible half of a
  // regenerate: a rewritten article arrives with a new title, and without this
  // the canvas keeps showing the old one over the new body — then writes it back
  // over the new one on the next save.
  useEffect(() => {
    const last = syncedMeta.current;
    if (initialTitle === last.title && initialMetaTitle === last.metaTitle && initialMetaDesc === last.metaDesc) return;
    syncedMeta.current = { title: initialTitle, metaTitle: initialMetaTitle, metaDesc: initialMetaDesc };
    if (editing || dirty) return;   // never clobber unsaved work
    setTitle(initialTitle);
    setMetaTitle(initialMetaTitle);
    setMetaDesc(initialMetaDesc);
  }, [initialTitle, initialMetaTitle, initialMetaDesc, editing, dirty]);

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

  const metaDirty = title !== syncedMeta.current.title
    || metaTitle !== syncedMeta.current.metaTitle
    || metaDesc !== syncedMeta.current.metaDesc;

  // Report unsaved work to whoever owns this editor (see `onDirtyChange`).
  useEffect(() => { onDirtyChange?.(dirty || metaDirty); }, [dirty, metaDirty, onDirtyChange]);

  /**
   * Write the canvas to the post, creating it first if this is still a blank
   * draft. `extra` carries publish fields (scheduled_at / status) so scheduling
   * from the editor is one round trip that also saves the words. Returns the
   * post id, or null when the write failed.
   */
  async function persist(extra?: { scheduled_at?: string | null; status?: 'review' | 'scheduled' }): Promise<string | null> {
    if (!editor) return null;
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
        body: JSON.stringify({
          domain_id: domainId,
          title: title.trim() || undefined,
          body_md: storedMd,
          scheduled_at: extra?.scheduled_at ?? undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      setSaving(false);
      if (!res.ok || !j.id) return null;
      baseline.current = md;
      setDirty(false);
      r.push(`/dashboard/posts/${j.id}`);
      return j.id as string;
    }
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body_md: storedMd, meta_title: metaTitle, meta_description: metaDesc, ...extra }),
    });
    setSaving(false);
    if (!res.ok) return null;
    baseline.current = md;
    syncedMeta.current = { title, metaTitle, metaDesc };
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    r.refresh();
    return postId;
  }

  async function save() { await persist(); }

  // Scheduling always saves first: the author means "publish what I'm looking
  // at", and a published post that's missing the last paragraph is a bug.
  async function schedule(iso: string) {
    // A scheduled post publishes unattended, so it needs a real title — the
    // slug, canonical URL and every share link are derived from it.
    if (!title.trim()) throw new Error(t('Give the draft a title before scheduling it.'));
    const id = await persist({ scheduled_at: iso, status: 'scheduled' });
    if (!id) throw new Error(t('Could not save the draft — try again.'));
    setScheduledAt(iso);
    // Now it IS a commitment — the write above put the post in the one status
    // the publisher cron reads.
    setWillPublish(true);
    setEditing(false);
  }

  async function unschedule() {
    const id = await persist({ scheduled_at: null, status: 'review' });
    if (!id) throw new Error(t('Could not update the draft — try again.'));
    setScheduledAt(null);
    setWillPublish(false);
  }

  async function done() {
    if (dirty || metaDirty) await save();
    setEditing(false);
  }

  function discard() {
    if (!editor) return;
    if ((dirty || metaDirty) && !confirm(t('Discard your changes since the last save?'))) return;
    editor.commands.setContent(baseline.current);   // baseline is the last-saved markdown
    setTitle(syncedMeta.current.title);
    setMetaTitle(syncedMeta.current.metaTitle);
    setMetaDesc(syncedMeta.current.metaDesc);
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
      pushCard({ id, label: instruction, status: 'error', error: t('Save this draft first — then grove assist can revise a selection.') });
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      pushCard({ id, label: instruction, status: 'error', error: t('Select a passage in the draft, then ask grove to revise it.') });
      return;
    }
    const text = editor.state.doc.textBetween(from, to, ' ');
    if (text.trim().length < 2) {
      pushCard({ id, label: instruction, status: 'error', error: t('Select a longer passage to revise.') });
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

  // ── in-canvas image generation ──
  // What the picture should be about, read at the moment the author asks: the
  // section they're writing in (nearest heading above the cursor), anything
  // they selected, and the title. The insert position is captured here too —
  // they'll keep typing while the image renders.
  function imageContext(): ImageContext {
    if (!editor) return { title };
    const { from, to } = editor.state.selection;
    imageAnchor.current = to;
    let heading = '';
    editor.state.doc.nodesBetween(0, Math.max(1, from), (node) => {
      if (node.type.name === 'heading') heading = node.textContent;
    });
    const selection = from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
    return { title, heading, selection: selection.slice(0, 1200) };
  }

  async function insertImage(image: { url: string; alt: string }) {
    if (!editor) return;
    if (!editing) setEditing(true);
    editor.setEditable(true);
    const at = Math.min(imageAnchor.current ?? editor.state.doc.content.size, editor.state.doc.content.size);
    // An image *node*, not markdown text: tiptap-markdown serializes it back to
    // `![alt](url)` on save, the same shape the pipeline's inline images use.
    editor.chain().focus().setTextSelection(at).setImage({ src: image.url, alt: sanitizeAlt(image.alt) }).run();
    setDirty(getMd(editor) !== baseline.current);
    // A generated image costs money — persist it immediately rather than
    // leaving it to be lost with an unsaved draft.
    if (postId != null) await persist();
  }

  /**
   * Images dropped or pasted onto the canvas itself.
   *
   * Sequential, not parallel: each insert shifts every position after it, so
   * uploading three at once and inserting them as they land would scatter them
   * in arrival order at stale anchors. One at a time keeps them in the order
   * the author dropped them.
   */
  async function uploadToCanvas(files: File[], at: number | null) {
    if (!editor) return;
    if (!domainId) {
      setCanvasDrop({ busy: false, error: t('Add a domain first to upload images.') });
      return;
    }
    setCanvasDrop({ busy: true, error: null });
    let anchor = at ?? editor.state.selection.to;
    for (const file of files) {
      try {
        const image = await uploadImage(file, domainId);
        imageAnchor.current = Math.min(anchor, editor.state.doc.content.size);
        await insertImage(image);
        anchor = editor.state.selection.to;
      } catch (e: any) {
        setCanvasDrop({ busy: false, error: e?.message ?? t('Could not upload that image.') });
        return;
      }
    }
    setCanvasDrop({ busy: false, error: null });
  }
  dropRef.current = uploadToCanvas;

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
            <span style={{ fontSize: 12, color: ACCENT_INK, fontWeight: 600 }}>{t('Editing')}</span>
            {(dirty || metaDirty) && <span style={{ fontSize: 11, color: 'var(--gv-amber)' }}>● unsaved</span>}
            {saved && <span style={{ fontSize: 11, color: ACCENT_INK }}>✓ saved</span>}
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', fontVariantNumeric: 'tabular-nums' }}>{wordCount.toLocaleString()} words · {Math.max(1, Math.round(wordCount / 230))} min read</span>
        {canEdit && (
          <button onClick={() => setFocusMode((f) => !f)} className="gv-ghost" style={ghostBtn}>
            {focusMode ? t('Exit focus') : t('Focus')}
          </button>
        )}
        {canEdit && schedulable && (
          <SchedulePicker
            scheduledAt={scheduledAt}
            willPublish={willPublish}
            disabled={saving}
            onSchedule={schedule}
            onClear={unschedule}
          />
        )}
        {editing ? (
          <>
            <button onClick={done} disabled={saving} className="gv-btn" style={primaryBtn}>
              <span style={{ display: 'flex' }}><Icon name="check" size={14} /></span>
              {saving ? t('Saving…') : postId == null ? t('Save draft') : (dirty || metaDirty) ? t('Save & done') : t('Done')}
            </button>
            <button onClick={discard} disabled={saving} className="gv-ghost" style={ghostBtn}>{t('Discard')}</button>
          </>
        ) : canEdit ? (
          <button onClick={enterEdit} className="gv-btn" style={primaryBtn}>{t('Edit draft')}</button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', marginBottom: 18, border: '1px solid var(--gv-line)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', position: 'sticky', top: 64, zIndex: 10, backdropFilter: 'blur(10px)' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-dim)', padding: '0 8px' }}>{t('Paragraph')}</span>
                <span style={tbDivider} />
                <ToolBtn on={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} serif>B</ToolBtn>
                <ToolBtn on={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} serif italic>i</ToolBtn>
                <ToolBtn on={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} serif>”</ToolBtn>
                <ToolBtn on={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}><Icon name="pipeline" size={15} /></ToolBtn>
                <ToolBtn on={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</ToolBtn>
                <ToolBtn on={editor?.isActive('link')} onClick={setLink}><Icon name="link" size={15} /></ToolBtn>
                <ToolBtn on={imageOpen} onClick={() => setImageOpen((o) => !o)}><Icon name="image" size={15} /></ToolBtn>
                <span style={{ flex: 1 }} />
                <button onClick={() => promptRef.current?.focus()} className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px', borderRadius: 8, border: 'none', background: 'rgba(162,255,1,0.14)', color: ACCENT_INK, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  <Icon name="sparkle" size={13} /> {t('Ask grove')}
                </button>
              </div>
            )}

            {/* Feedback for a drop/paste onto the canvas, which has no panel of
                its own to report into. */}
            {canEdit && (canvasDrop.busy || canvasDrop.error) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', marginBottom: 14, borderRadius: 10, border: '1px solid var(--gv-line)', background: 'rgba(255,255,255,0.02)' }}>
                {canvasDrop.busy && <span style={{ display: 'inline-flex', gap: 4 }}><span className="gv-tdot" /><span className="gv-tdot" style={{ animationDelay: '.18s' }} /><span className="gv-tdot" style={{ animationDelay: '.36s' }} /></span>}
                <span style={{ fontSize: 12, color: canvasDrop.error ? 'var(--gv-red)' : 'var(--gv-dim)' }}>
                  {canvasDrop.error ?? t('Uploading your image…')}
                </span>
                {canvasDrop.error && (
                  <button onClick={() => setCanvasDrop({ busy: false, error: null })} className="gv-ghost" aria-label={t('Dismiss')}
                    style={{ marginLeft: 'auto', display: 'flex', border: 'none', background: 'transparent', color: 'var(--gv-dim)', cursor: 'pointer', padding: 2 }}>
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            )}

            {/* image generation, inserted at the cursor */}
            {canEdit && imageOpen && (
              <ImageStudio
                domainId={domainId}
                contextOf={imageContext}
                onInsert={insertImage}
                onClose={() => setImageOpen(false)}
              />
            )}

            {/* writing canvas — the title is the article's first line, like the rendered post */}
            <div
              className="gv-editor-canvas gv-canvas-prose"
              onClick={enterEdit}
              style={{
                background: '#0d100c',
                border: `1px solid ${editing ? 'rgba(162,255,1,0.4)' : 'rgba(255,255,255,0.06)'}`,
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
                  placeholder={t('Untitled draft')}
                  spellCheck={false}
                  style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', padding: 0 }}
                />
              ) : (
                <h1 className="gv-canvas-title">{title || t('Untitled draft')}</h1>
              )}
              <EditorContent editor={editor} />
            </div>

            {/* compact SEO panel */}
            {canEdit && (
              <>
                <button
                  onClick={() => setSeoOpen((o) => !o)}
                  className="gv-tool"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 14, border: '1px solid var(--gv-line)', background: 'var(--gv-card)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '13px 18px', borderRadius: seoOpen ? '12px 12px 0 0' : 12, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ display: 'flex', transform: seoOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .2s' }}><Icon name="chevron" size={14} /></span>
                  {t('Title & SEO')}
                  {metaDirty && <span style={{ color: 'var(--gv-amber)', fontSize: 11, fontWeight: 500 }}>● unsaved</span>}
                </button>
                {seoOpen && (
                  <div style={{ border: '1px solid var(--gv-line)', borderTop: 'none', borderRadius: '0 0 12px 12px', background: '#0d100c', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <label style={lbl}>{t('Meta title')} <span style={{ color: metaTitle.length > 60 ? 'var(--gv-red)' : 'var(--gv-dim)' }}>({metaTitle.length}/60)</span></label>
                    <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={80} className="gv-prompt" style={inp} />
                    <label style={lbl}>{t('Meta description')} <span style={{ color: metaDesc.length > 155 ? 'var(--gv-red)' : 'var(--gv-dim)' }}>({metaDesc.length}/155)</span></label>
                    <textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} maxLength={160} rows={3} className="gv-prompt" style={inp} />
                    <button onClick={save} disabled={saving || !metaDirty} className="gv-btn" style={{ ...primaryBtn, alignSelf: 'flex-start' }}>
                      {saving ? t('Saving…') : t('Save meta')}
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
            <div style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(162,255,1,0.2)', borderRadius: 18, padding: '18px 18px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(162,255,1,0.14)', border: '1px solid rgba(162,255,1,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT_INK }}><Icon name="sparkle" size={15} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)' }}>{t('grove assist')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gv-dim)' }}>{pendingCount} suggestion{pendingCount === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 8px 8px 14px' }}>
                <input
                  ref={promptRef}
                  className="gv-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPrompt(); } }}
                  placeholder={t('Select text, then ask grove to revise…')}
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
                    <div key={c.id} style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: '14px 15px', opacity: resolved ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ACCENT_INK, background: 'rgba(162,255,1,0.12)', borderRadius: 5, padding: '3px 7px' }}>{t('Ask grove')}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-soft)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                      </div>

                      {c.status === 'thinking' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 2px' }}>
                          <span style={{ display: 'inline-flex', gap: 4 }}><span className="gv-tdot" /><span className="gv-tdot" style={{ animationDelay: '.18s' }} /><span className="gv-tdot" style={{ animationDelay: '.36s' }} /></span>
                          <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>{t('grove is writing…')}</span>
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
                            <button onClick={() => applyCard(c)} className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}><Icon name="check" size={13} /> {t('Apply')}</button>
                            <button onClick={() => dismissCard(c.id)} className="gv-ghost" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}>{t('Dismiss')}</button>
                          </div>
                        </div>
                      )}

                      {resolved && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: c.status === 'applied' ? ACCENT_INK : 'var(--gv-faint)' }}>
                          <span style={{ display: 'flex' }}><Icon name={c.status === 'applied' ? 'check' : 'x'} size={13} /></span>
                          {c.status === 'applied' ? t('Applied to draft') : t('Dismissed')}
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
        borderRadius: 8, border: `1px solid ${on ? 'rgba(162,255,1,0.3)' : 'rgba(255,255,255,0.08)'}`,
        background: on ? 'rgba(162,255,1,0.14)' : 'transparent', color: on ? ACCENT_INK : 'var(--gv-soft)',
        fontFamily: serif ? "'Newsreader', Georgia, serif" : 'inherit', fontStyle: italic ? 'italic' : 'normal',
        fontWeight: serif ? 700 : 500, fontSize: serif ? 15 : 13, lineHeight: 1, cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

const hintBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: ACCENT_INK, fontSize: 12,
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
