'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PipelineActions({ domainId }: { domainId?: string }) {
  const r = useRouter();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);

  async function enqueue() {
    if (!domainId || !topic.trim()) return;
    setBusy(true);
    await fetch('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, topic }),
    });
    setBusy(false);
    setTopic('');
    r.refresh();
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Add a topic… e.g. 'how to reduce churn with onboarding nudges'"
        style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--line)', borderRadius: 10, background: 'white' }}
      />
      <button className="btn btn-primary btn-sm" onClick={enqueue} disabled={busy || !topic}>{busy ? '…' : 'Queue topic'}</button>
    </div>
  );
}
