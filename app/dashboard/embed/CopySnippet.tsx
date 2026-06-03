'use client';
import { useState } from 'react';

export default function CopySnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={copy}
      className="btn btn-sm"
      style={{
        marginTop: 16, background: copied ? 'var(--leaf)' : 'var(--bone)',
        color: copied ? 'var(--ink)' : 'var(--ink)', border: 'none',
      }}
    >
      {copied ? '✓ Copied to clipboard' : 'Copy snippet'}
    </button>
  );
}
