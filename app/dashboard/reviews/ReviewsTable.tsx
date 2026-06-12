'use client';

import { useState } from 'react';
import { ScoreRing, RubricBars } from '../QualityCharts';

type Issue = { rule: string; severity: 'block' | 'rewrite' | 'note'; note: string };
type EvaluationRow = {
  id: string;
  post_id: string;
  attempt: number;
  action: 'approve' | 'rewrite' | 'reject';
  pass: boolean;
  scores: { strategic_fit: number; marketing: number; craft: number; safety: number; overall: number };
  issues: Issue[];
  rewrite_brief: string | null;
  created_at: string;
  posts: { title: string | null; slug: string | null; status: string };
};

export default function ReviewsTable({ rows }: { rows: EvaluationRow[] }) {
  const [open, setOpen] = useState<EvaluationRow | null>(null);

  if (rows.length === 0) {
    return (
      <div style={{ marginTop: 26, background: 'white', border: '1px dashed var(--line)', borderRadius: 14, padding: '40px 30px', textAlign: 'center', color: 'var(--clay)' }}>
        No manager reviews yet. They appear as soon as new posts run through the pipeline.
      </div>
    );
  }

  return (
    <>
      <div style={{ marginTop: 26, background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--paper)' }}>
              <Th>Post</Th>
              <Th>Action</Th>
              <Th>Overall</Th>
              <Th>Issues</Th>
              <Th>Attempt</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const issueCount = r.issues.length;
              const blocks = r.issues.filter((i) => i.severity === 'block').length;
              const rewrites = r.issues.filter((i) => i.severity === 'rewrite').length;
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r)}
                  style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}
                >
                  <Td>{r.posts?.title ?? '(untitled)'}</Td>
                  <Td><ActionTag action={r.action} /></Td>
                  <Td>{r.scores?.overall ?? '—'}</Td>
                  <Td>
                    <span style={{ color: 'var(--clay)', fontSize: 13 }}>
                      {issueCount === 0
                        ? '—'
                        : `${blocks ? `${blocks} block · ` : ''}${rewrites ? `${rewrites} rewrite` : ''}${!blocks && !rewrites ? `${issueCount} note` : ''}`}
                    </span>
                  </Td>
                  <Td><span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--clay)' }}>{r.attempt} of 2</span></Td>
                  <Td><span style={{ color: 'var(--clay)', fontSize: 13 }}>{relativeTime(r.created_at)}</span></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && <Drawer row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Drawer({ row, onClose }: { row: EvaluationRow; onClose: () => void }) {
  const blockingIssues = row.issues.filter((i) => i.severity !== 'note');
  const noteIssues = row.issues.filter((i) => i.severity === 'note');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,46,31,0.30)', zIndex: 50,
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%', width: 'min(560px, 92vw)',
          background: 'white', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)', overflow: 'auto',
          padding: '28px 30px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--clay)' }}>{relativeTime(row.created_at)} · attempt {row.attempt}/2</div>
            <h3 className="display" style={{ fontSize: 22, marginTop: 4 }}>{row.posts?.title ?? '(untitled)'}</h3>
            <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
              <ActionTag action={row.action} />
              <span style={{ color: 'var(--ink)', fontSize: 14 }}>overall <strong>{row.scores?.overall ?? '—'}</strong>/100</span>
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        <ScoresRow scores={row.scores} />

        <Section title="Issues">
          {blockingIssues.length === 0 && noteIssues.length === 0 ? (
            <p style={{ color: 'var(--clay)', fontSize: 14 }}>No issues raised — clean approval.</p>
          ) : (
            <>
              {blockingIssues.map((i, idx) => <IssueRow key={`${i.rule}-${idx}`} issue={i} />)}
              {noteIssues.map((i, idx) => <IssueRow key={`note-${idx}`} issue={i} />)}
            </>
          )}
        </Section>

        {row.rewrite_brief && (
          <Section title="Rewrite brief (sent to writer)">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
              {row.rewrite_brief}
            </pre>
          </Section>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          {row.posts?.slug && (
            <a
              href={`/dashboard/posts/${row.post_id}`}
              className="btn btn-ghost"
              style={{ padding: '10px 16px', fontSize: 14 }}
            >
              View draft →
            </a>
          )}
          {row.action !== 'approve' && (
            <OverrideButton postId={row.post_id} />
          )}
        </div>
      </aside>
    </div>
  );
}

function OverrideButton({ postId }: { postId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function go() {
    if (!confirm('Override manager and move this post to review?')) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}/override`, { method: 'POST' });
    setBusy(false);
    if (res.ok) setDone(true);
  }
  if (done) return <span style={{ color: 'var(--moss)', fontSize: 14 }}>✓ moved to review</span>;
  return (
    <button onClick={go} disabled={busy} className="btn btn-primary" style={{ padding: '10px 16px', fontSize: 14 }}>
      {busy ? 'Overriding…' : 'Override → approve'}
    </button>
  );
}

function ScoresRow({ scores }: { scores: EvaluationRow['scores'] }) {
  return (
    <Section title="Scores">
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScoreRing value={scores?.overall ?? 0} size={84} />
        <RubricBars scores={scores} />
      </div>
    </Section>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const tone = issue.severity === 'block' ? '#b04a3b' : issue.severity === 'rewrite' ? 'var(--ink)' : 'var(--clay)';
  return (
    <div style={{ borderLeft: `3px solid ${tone}`, paddingLeft: 12, marginBottom: 14 }}>
      <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: tone, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        [{issue.rule}] {issue.severity}
      </div>
      <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink)', lineHeight: 1.55 }}>{issue.note}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionTag({ action }: { action: 'approve' | 'rewrite' | 'reject' }) {
  const c = action === 'approve'
    ? { bg: 'rgba(108,201,138,0.20)', fg: 'var(--moss)' }
    : action === 'rewrite'
      ? { bg: 'var(--paper)', fg: 'var(--ink)' }
      : { bg: 'rgba(176,74,59,0.14)', fg: '#b04a3b' };
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {action}
    </span>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, color: 'var(--moss)', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
    {children}
  </th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: '12px 16px', color: 'var(--ink)' }}>{children}</td>
);

const closeBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)',
  background: 'white', fontSize: 20, color: 'var(--clay)', cursor: 'pointer',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = ms / 60000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 7) return `${Math.round(day)}d ago`;
  return new Date(iso).toLocaleDateString();
}
