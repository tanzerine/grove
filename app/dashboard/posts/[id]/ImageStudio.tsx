'use client';
import { useState } from 'react';
import Icon from '../../gv-icons';

/**
 * In-canvas image generation for the editor. Sits under the formatting toolbar
 * and drops an illustration wherever the cursor was when the author asked.
 *
 * Works on an unsaved draft too — /api/images/illustration is domain-scoped, so
 * the Write page's blank canvas can generate pictures before it's ever saved.
 * Generation is slow and occasionally off-brief, so the result is previewed and
 * inserted on confirmation (same suggest → apply shape as grove assist).
 */

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

const HINTS = ['Illustrate this section', 'Diagram the process', 'Before vs. after', 'The concept, abstractly'];

export type ImageContext = { title?: string; heading?: string; selection?: string };

type Result = { url: string; alt: string };

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
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [inserted, setInserted] = useState(false);

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
        <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>generated in your house style, inserted at the cursor</span>
        <button onClick={onClose} className="gv-ghost" aria-label="Close image tool"
          style={{ marginLeft: 'auto', display: 'flex', border: 'none', background: 'transparent', color: 'var(--gv-dim)', cursor: 'pointer', padding: 2 }}>
          <Icon name="x" size={14} />
        </button>
      </div>

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

      {busy && (
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
