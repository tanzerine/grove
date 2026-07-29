'use client';
import { useRef, useState } from 'react';
import Icon from '../../gv-icons';
import { MAX_UPLOAD_MB, uploadImage } from './upload-image';

/**
 * The editor's image tool: generate one, or bring your own.
 *
 * Sits under the formatting toolbar and drops the picture wherever the cursor
 * was when the author asked. Both halves are domain-scoped rather than
 * post-scoped, so the Write page's blank canvas can take an image before it's
 * ever saved.
 *
 * Generated images are previewed before insertion (generation is slow and
 * occasionally off-brief — same suggest → apply shape as grove assist). An
 * upload skips the preview: the author has already seen their own picture, and
 * making them approve it twice is friction with nothing behind it.
 */

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

const HINTS = ['Illustrate this section', 'Diagram the process', 'Before vs. after', 'The concept, abstractly'];

export type ImageContext = { title?: string; heading?: string; selection?: string };

type Result = { url: string; alt: string };
type Mode = 'generate' | 'upload';

export default function ImageStudio({
  domainId, contextOf, onInsert, onClose,
}: {
  domainId?: string;
  /** Read the canvas at request time: cursor section, selection, title. */
  contextOf: () => ImageContext;
  /** Insert at the position captured when generation started. */
  onInsert: (image: Result) => void | Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('generate');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [inserted, setInserted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Capture the cursor before the file dialog steals focus. `contextOf` is what
   * records the insert anchor, and by the time the upload resolves the
   * selection may have moved — so it's read on pick, not on completion.
   */
  async function takeFile(file: File | null | undefined) {
    if (!file) return;
    if (!domainId) { setErr('Add a domain first to upload images.'); return; }
    contextOf();
    setBusy(true); setErr(null); setResult(null); setInserted(false);
    try {
      const image = await uploadImage(file, domainId);
      await onInsert(image);
      setInserted(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not upload that image.');
    }
    setBusy(false);
  }

  async function generate(explicitHint?: string) {
    if (!domainId) { setErr('Add a domain first to generate images.'); return; }
    const ask = (explicitHint ?? hint).trim();
    // 'Illustrate this section' is the empty ask — the canvas context carries it.
    const asHint = ask && ask !== HINTS[0] ? ask : '';
    setBusy(true); setErr(null); setResult(null); setInserted(false);
    try {
      const res = await fetch('/api/images/illustration', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId, hint: asHint || undefined, ...contextOf() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) setErr(j.error ?? 'Could not generate an image. Try again.');
      else setResult({ url: j.url, alt: j.alt ?? '' });
    } catch { setErr('Something went wrong. Try again.'); }
    setBusy(false);
  }

  async function insert() {
    if (!result) return;
    await onInsert(result);
    setInserted(true);
    setResult(null);
  }

  return (
    <div style={{ border: '1px solid var(--gv-line)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', padding: '13px 14px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
        <span style={{ display: 'flex', color: ACCENT_INK }}><Icon name="image" size={15} /></span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gv-ink)' }}>Add an image</span>
        <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>
          {mode === 'generate' ? 'generated in your house style, inserted at the cursor' : 'your own file, inserted at the cursor'}
        </span>
        <button onClick={onClose} className="gv-ghost" aria-label="Close image tool"
          style={{ marginLeft: 'auto', display: 'flex', border: 'none', background: 'transparent', color: 'var(--gv-dim)', cursor: 'pointer', padding: 2 }}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div role="tablist" aria-label="Image source" style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 3, width: 'fit-content' }}>
        {(['generate', 'upload'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setErr(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700, padding: '6px 13px', borderRadius: 8,
              background: mode === m ? ACCENT : 'transparent',
              color: mode === m ? 'var(--gv-on-accent)' : 'var(--gv-dim)',
            }}>
            <Icon name={m === 'generate' ? 'sparkle' : 'image'} size={12} />
            {m === 'generate' ? 'Generate' : 'Upload'}
          </button>
        ))}
      </div>

      {mode === 'upload' ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              takeFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileRef.current?.click()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '22px 16px', borderRadius: 12, cursor: busy ? 'default' : 'pointer',
              border: `1px dashed ${dragOver ? ACCENT : 'rgba(255,255,255,0.16)'}`,
              background: dragOver ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
              transition: 'border-color .15s, background .15s',
            }}>
            <span style={{ display: 'flex', color: dragOver ? ACCENT_INK : 'var(--gv-dim)' }}><Icon name="image" size={19} /></span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-soft)' }}>
              {busy ? 'Uploading…' : 'Drop an image here, or click to choose one'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--gv-faint)' }}>
              PNG, JPEG, WebP or GIF · up to {MAX_UPLOAD_MB} MB
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <p style={{ fontSize: 11, color: 'var(--gv-faint)', margin: '9px 0 0' }}>
            You can also paste an image, or drag one straight onto the page.
          </p>
        </>
      ) : (
      <>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); generate(); } }}
          placeholder="What should the picture show? (blank = illustrate the section you're in)"
          className="gv-prompt"
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 12px', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none' }}
        />
        <button onClick={() => generate()} disabled={busy} className="gv-btn"
          style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '0 14px', borderRadius: 10, cursor: busy ? 'default' : 'pointer' }}>
          <Icon name="sparkle" size={13} /> {busy ? 'Drawing…' : 'Generate'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {HINTS.map((h) => (
          <button key={h} onClick={() => { setHint(h); generate(h); }} disabled={busy} className="gv-chip"
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 999, padding: '5px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {h}
          </button>
        ))}
      </div>
      </>
      )}

      {busy && mode === 'generate' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }}>
          <span style={{ display: 'inline-flex', gap: 4 }}><span className="gv-tdot" /><span className="gv-tdot" style={{ animationDelay: '.18s' }} /><span className="gv-tdot" style={{ animationDelay: '.36s' }} /></span>
          <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>grove is drawing — this takes a few seconds…</span>
        </div>
      )}
      {err && <p style={{ fontSize: 12, color: 'var(--gv-red)', margin: '10px 0 0' }}>{err}</p>}
      {inserted && !result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 11, fontSize: 12, color: ACCENT_INK }}>
          <span style={{ display: 'flex' }}><Icon name="check" size={13} /></span> Inserted into the draft.
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt={result.alt} style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--gv-line)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
            <button onClick={insert} className="gv-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}>
              <Icon name="check" size={13} /> Insert at cursor
            </button>
            <button onClick={() => generate()} className="gv-ghost"
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}>
              <Icon name="refresh" size={13} /> Try another
            </button>
            <button onClick={() => setResult(null)} className="gv-ghost"
              style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
