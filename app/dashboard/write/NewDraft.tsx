'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const ACCENT = '#63c281';

/**
 * The Write entry point: opens a blank editor straight away. On mount it
 * creates an empty manual draft (same as the old "Open blank editor" action)
 * and replaces the route with the editor. Creation runs in an effect — never
 * during prefetch — so navigating here is what actually starts a draft.
 */
export default function NewDraft({ domainId }: { domainId: string }) {
  const r = useRouter();
  const started = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (started.current) return;   // guard StrictMode double-invoke
    started.current = true;
    (async () => {
      try {
        const res = await fetch('/api/posts/manual', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain_id: domainId }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.id) { r.replace(`/dashboard/posts/${j.id}`); return; }
        setError(true);
      } catch { setError(true); }
    })();
  }, [domainId, r]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 320, color: '#9aa096' }}>
      {error ? (
        <>
          <div style={{ fontSize: 14, color: '#cdd2c9' }}>Couldn’t open a blank draft.</div>
          <button onClick={() => { started.current = false; setError(false); r.refresh(); }} className="gv-btn"
            style={{ border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '9px 16px', borderRadius: 9, cursor: 'pointer' }}>
            Try again
          </button>
          <Link href="/dashboard/write/ideas" style={{ fontSize: 12.5, color: '#9aa096' }}>or browse idea studio →</Link>
        </>
      ) : (
        <>
          <span style={{ display: 'inline-flex', gap: 5 }}>
            <span className="gv-tdot" /><span className="gv-tdot" style={{ animationDelay: '.18s' }} /><span className="gv-tdot" style={{ animationDelay: '.36s' }} />
          </span>
          <div style={{ fontSize: 13.5 }}>Opening a blank draft…</div>
        </>
      )}
    </div>
  );
}
