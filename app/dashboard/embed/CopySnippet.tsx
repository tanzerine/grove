'use client';
import { useState } from 'react';
import Icon from '../gv-icons';

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
