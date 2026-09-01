'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './gv-icons';
import { highlight, searchPosts, type SearchablePost } from '@/lib/post-search';
import { useT } from './i18n';
import { msg } from '@/lib/i18n';

const MAX = 8;

/**
 * Overview search bar. Finds the customer's own articles by title, topic,
 * slug or meta description and opens the one they pick.
 *
 * Two sources, on purpose: `seed` is the post list the overview page already
 * loaded, ranked locally so the very first keystroke shows something with zero
 * latency; /api/posts/search then answers over the site's WHOLE archive (the
 * seed is only the recent slice) and takes over as soon as it lands for the
 * query currently in the box.
 */
export default function DashSearch({ seed }: { seed: SearchablePost[] }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [server, setServer] = useState<{ q: string; results: SearchablePost[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const local = useMemo(() => searchPosts(seed, q, MAX), [seed, q]);
  const fresh = server && server.q === q.trim();
  const results = fresh ? server.results : local;
  const total = fresh ? server.total : local.length;
  const query = q.trim();

  // Debounced archive search. The abort keeps a slow response for "cof" from
  // landing after "coffee" and overwriting it.
  useEffect(() => {
    if (query.length < 2) { setServer(null); setLoading(false); return; }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setServer({ q: query, results: json.results ?? [], total: json.total ?? 0 });
      } catch {
        /* keep the local results — the bar still works offline/on a 500 */
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  useEffect(() => { setActive(0); }, [query]);

  // ⌘K / Ctrl-K focuses the bar (the chip in the corner promises it).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function go(post: SearchablePost | undefined) {
    if (!post) return;
    setOpen(false);
    router.push(`/dashboard/posts/${post.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === 'ArrowDown'
        ? (i + 1) % results.length
        : (i - 1 + results.length) % results.length));
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
  }

  const showPanel = open && query.length > 0;

  return (
    <div ref={boxRef} style={{ flex: 1, minWidth: 240, maxWidth: 420, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.035)', border: `1px solid rgba(255,255,255,${showPanel ? 0.18 : 0.1})`, borderRadius: 10, padding: '9px 13px', transition: 'border-color .15s' }}>
        <span style={{ color: 'var(--gv-fainter)', display: 'flex' }}><Icon name="search" size={16} /></span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t(t('Search your articles…'))}
          aria-label={t(t('Search your articles'))}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="gv-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && results[active] ? `gv-search-opt-${results[active].id}` : undefined}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--gv-ink)', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }}
        />
        {q ? (
          <button type="button" onClick={() => { setQ(''); setServer(null); inputRef.current?.focus(); }} aria-label={t(t('Clear search'))}
            style={{ background: 'transparent', border: 'none', color: 'var(--gv-soft)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, lineHeight: 1, padding: 2 }}>×</button>
        ) : (
          /* --gv-soft, not --gv-dim/--gv-fainter — this chip sits on the
             search bar's own tint, which shaves ~0.3 off the ratio. */
          <span style={{ fontSize: 10.5, color: 'var(--gv-soft)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, padding: '1px 6px' }}>⌘K</span>
        )}
      </div>

      {showPanel && (
        <div id="gv-search-results" role="listbox" aria-label={t(t('Article search results'))}
          style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 6, zIndex: 60, maxHeight: 400, overflowY: 'auto' }}>
          {results.map((p, i) => {
            const st = statusOf(p.status);
            return (
              <button key={p.id} id={`gv-search-opt-${p.id}`} role="option" aria-selected={i === active}
                onClick={() => go(p)} onMouseEnter={() => setActive(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: i === active ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', borderRadius: 9, padding: '9px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gv-dim)' }}>
                  <Icon name="doc" size={14} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Marked text={p.title ?? p.topic ?? 'Untitled'} query={query} />
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--gv-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[t(st.label), p.topic && p.topic !== p.title ? p.topic : null, when(p)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            );
          })}

          {results.length === 0 && (
            <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--gv-faint)' }}>
              {query.length < 2
                ? t('Keep typing to search your articles…')
                : loading ? 'Searching…' : <>{t('No article matches “')}{query}”.</>}
            </div>
          )}

          {total > results.length && (
            <div style={{ padding: '8px 12px 4px', fontSize: 11, color: 'var(--gv-fainter)', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4 }}>
              Showing {results.length} of {total} matches — refine to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((seg, i) =>
        seg.hit
          ? <mark key={i} style={{ background: 'rgba(162,255,1,0.18)', color: 'inherit', padding: 0, borderRadius: 2 }}>{seg.text}</mark>
          : <span key={i}>{seg.text}</span>)}
    </>
  );
}

/** Status label keys. Translated at the call site — this is module-level, so
 *  `t` is not in scope here and a frozen English label would leak through. */
function statusOf(status: string | null | undefined): { label: string } {
  switch (status) {
    case 'published': return { label: msg('Live') };
    case 'scheduled': return { label: msg('Scheduled') };
    case 'review': return { label: msg('In review') };
    case 'failed': return { label: msg('Failed') };
    default: return { label: msg('Drafting') };
  }
}

function when(p: SearchablePost): string {
  const iso = p.published_at ?? p.scheduled_at ?? p.created_at;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
