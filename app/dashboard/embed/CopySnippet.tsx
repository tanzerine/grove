'use client';
import { useState } from 'react';
import Icon from '../gv-icons';
import { captureClient } from '@/lib/analytics/capture-client';

/**
 * `mode`/`domainId` are optional so the button stays reusable for snippets
 * that aren't embeds; when they're supplied the copy is counted. Copying the
 * snippet is the closest thing to an intent-to-install signal we can observe —
 * the paste itself happens on the customer's own site, where we can't see it.
 */
export default function CopySnippet({
  snippet,
  mode,
  domainId,
}: {
  snippet: string;
  mode?: 'blog' | 'widget' | 'feed';
  domainId?: string;
}) {
  const [copied, setCopied] = useState(false);

  function report() {
    if (mode && domainId) captureClient('embed_snippet_copied', { mode, domain_id: domainId });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      report();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for old browsers
      const el = document.createElement('textarea');
      el.value = snippet;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      report(); // the legacy path is still a copy — don't under-count old browsers
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={copy}
      className="gv-ghost"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.05)', color: 'var(--gv-soft)', fontFamily: 'inherit',
        fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
        transition: 'background .2s',
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
    </button>
  );
}
