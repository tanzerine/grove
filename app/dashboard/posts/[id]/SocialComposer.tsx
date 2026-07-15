'use client';
/**
 * Social distribution panel on the post page — the review-and-publish flow
 * for channel copy. Owners edit the per-platform text the pipeline wrote,
 * save it, and post each channel manually (or let auto-share handle it at
 * publish time). Per-channel state (posted / failed / dry-run) comes from
 * posts.social_published.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { firstTweet } from '@/lib/social/compose';

type ChannelKey = 'x' | 'linkedin' | 'instagram';
type PublishRecord = { id?: string; at?: string; status?: number; error?: string; dry_run?: boolean };

export type ComposerPlatform = { id: ChannelKey; handle: string | null; connected: boolean };

const LABEL: Record<ChannelKey, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram' };
const HINT: Record<ChannelKey, string> = {
  x: 'First line becomes the tweet; the article link is appended automatically.',
  linkedin: 'Posted as-is with the article attached as a link card.',
  instagram: 'Caption for the cover image. “Link in bio” + URL are appended.',
};

export default function SocialComposer({
  postId, domainId, published, social, socialPublished, platforms, autoShare, hasWebhook, postUrl,
}: {
  postId: string;
  domainId: string;
  published: boolean;
  social: Partial<Record<ChannelKey, string>> & { disabled?: string[] };
  socialPublished: Record<string, PublishRecord>;
  platforms: ComposerPlatform[];
  autoShare: boolean;
  hasWebhook: boolean;
  postUrl: string;
}) {
  const r = useRouter();
  const [drafts, setDrafts] = useState<Record<ChannelKey, string>>({
    x: social.x ?? '', linkedin: social.linkedin ?? '', instagram: social.instagram ?? '',
  });
  const [auto, setAuto] = useState(autoShare);
  const [off, setOff] = useState<Set<ChannelKey>>(
    () => new Set((social.disabled ?? []) as ChannelKey[]),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const outletCount = platforms.filter((p) => p.connected).length + (hasWebhook ? 1 : 0);

  // Drafts count too: right after generation the copy lives only in local
  // state until router.refresh() lands (and must survive it failing).
  const hasCopy = !!(social.x || social.linkedin || social.instagram)
    || !!(drafts.x || drafts.linkedin || drafts.instagram);
  const dirty = useMemo(
    () => (['x', 'linkedin', 'instagram'] as ChannelKey[]).some((k) => drafts[k] !== (social[k] ?? '')),
    [drafts, social],
  );

  async function generate() {
    if (hasCopy && dirty && !confirm('Regenerating replaces your edits. Continue?')) return;
    setBusy('generate'); setNote(null);
    try {
      const res = await fetch(`/api/posts/${postId}/social`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ ok: false, text: `Couldn't write social posts: ${j.error ?? 'unknown error'}` });
        return;
      }
      // Pull the fresh copy straight into the textareas; refresh syncs the rest.
      if (j.social) setDrafts({ x: j.social.x ?? '', linkedin: j.social.linkedin ?? '', instagram: j.social.instagram ?? '' });
      r.refresh();
    } catch {
      setNote({ ok: false, text: "Couldn't write social posts: the request didn't complete — try again." });
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoShare() {
    if (outletCount === 0) return;
    const next = !auto;
    setAuto(next); setNote(null);
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, auto_social: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setAuto(!next);
      setNote({ ok: false, text: "Couldn't update auto-share — try again." });
      return;
    }
    r.refresh();
  }

  async function toggleChannel(pf: ChannelKey) {
    const next = new Set(off);
    if (next.has(pf)) next.delete(pf); else next.add(pf);
    setOff(next); setNote(null);
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ social: { ...drafts, disabled: [...next] } }),
    }).catch(() => null);
    if (!res?.ok) {
      setOff(new Set(off));
      setNote({ ok: false, text: "Couldn't update the channel — try again." });
      return;
    }
    r.refresh();
  }

  async function save(): Promise<boolean> {
    setBusy('save'); setNote(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ social: { ...drafts, disabled: [...off] } }),
      });
      if (!res.ok) { setNote({ ok: false, text: 'Saving the copy failed — try again.' }); return false; }
      setNote({ ok: true, text: 'Copy saved.' });
      r.refresh();
      return true;
    } catch {
      setNote({ ok: false, text: 'Saving the copy failed — try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function postNow(channel: ChannelKey | 'webhook') {
    if (dirty && !(await save())) return;
    setBusy(channel); setNote(null);
    try {
      const res = await fetch(`/api/posts/${postId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platforms: [channel] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ ok: false, text: `Sharing failed: ${j.error ?? 'unknown error'}` });
      } else {
        const rec: PublishRecord | undefined = j.result?.[channel];
        const label = channel === 'webhook' ? 'Webhook' : LABEL[channel];
        setNote(rec?.error
          ? { ok: false, text: `${label}: ${rec.error}` }
          : rec?.dry_run
            ? { ok: true, text: `${label}: dry run — nothing was posted (SOCIAL_DRY_RUN is on).` }
            : { ok: true, text: `${label}: posted.` });
      }
      r.refresh();
    } catch {
      setNote({ ok: false, text: 'Sharing failed: the request didn’t complete — try again.' });
    } finally {
      setBusy(null);
    }
  }

  const ghost: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 9, cursor: 'pointer' };
  const primary: React.CSSProperties = { ...ghost, border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontWeight: 700 };

  return (
    <div style={{ marginTop: 18, background: '#0e110d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 28px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 22, margin: '4px 0' }}>Social posts</h3>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ToggleSwitch on={auto && outletCount > 0} disabled={outletCount === 0} onClick={toggleAutoShare} />
          <span style={{ fontSize: 11.5, color: auto && outletCount > 0 ? 'var(--gv-soft)' : 'var(--gv-faint)' }}>
            Auto-share on publish
          </span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--gv-fainter)' }}>
          {outletCount === 0
            ? <><a href="/dashboard/connections" style={{ color: 'var(--gv-dim)', textDecoration: 'underline' }}>Connect an account</a> to enable.</>
            : auto
              ? published ? 'was applied at publish.' : 'each channel below can opt out.'
              : 'off — post each channel yourself below.'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {hasCopy && dirty && (
            <button className="gv-btn" style={primary} onClick={save} disabled={!!busy}>
              {busy === 'save' ? 'Saving…' : 'Save copy'}
            </button>
          )}
          <button className="gv-ghost" style={ghost} onClick={generate} disabled={!!busy}>
            {busy === 'generate' ? 'Writing…' : hasCopy ? 'Regenerate all' : 'Write social posts'}
          </button>
        </div>
      </div>

      {note && (
        <div style={{ marginTop: 12, fontSize: 12.5, borderRadius: 10, padding: '9px 13px', background: note.ok ? 'rgba(99,194,129,0.08)' : 'rgba(201,127,127,0.08)', border: `1px solid ${note.ok ? 'rgba(99,194,129,0.24)' : 'rgba(201,127,127,0.3)'}`, color: note.ok ? 'var(--gv-accent)' : 'var(--gv-red-soft)' }}>
          {note.text}
        </div>
      )}

      {!hasCopy ? (
        <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: '14px 0 4px', lineHeight: 1.6 }}>
          No channel copy yet. Grove writes a native post for each platform from this article —
          an X hook, a LinkedIn post, and an Instagram caption — which you can edit before anything goes out.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          {platforms.map((pf) => (
            <Channel
              key={pf.id}
              pf={pf}
              value={drafts[pf.id]}
              onChange={(v) => setDrafts((d) => ({ ...d, [pf.id]: v }))}
              record={socialPublished[pf.id]}
              published={published}
              busy={busy}
              postUrl={postUrl}
              onPost={() => postNow(pf.id)}
              autoShare={auto}
              autoOn={!off.has(pf.id)}
              onToggleAuto={() => toggleChannel(pf.id)}
            />
          ))}
          {hasWebhook && (
            <WebhookRow record={socialPublished.webhook} published={published} busy={busy} onSend={() => postNow('webhook')} />
          )}
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 34, height: 20, borderRadius: 999, border: 'none', position: 'relative', flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'var(--gv-accent)' : 'rgba(255,255,255,0.14)',
        transition: 'background .15s', opacity: disabled ? 0.5 : 1, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2.5, left: on ? 16.5 : 2.5, width: 15, height: 15,
        borderRadius: '50%', background: 'white', transition: 'left .15s',
      }} />
    </button>
  );
}

function StatusChip({ record, xId }: { record?: PublishRecord; xId?: string }) {
  if (!record) return null;
  if (record.error) {
    return <span style={{ fontSize: 11, color: 'var(--gv-red-soft)' }} title={record.error}>failed — {record.error.slice(0, 80)}</span>;
  }
  if (record.dry_run) return <span style={{ fontSize: 11, color: 'var(--gv-amber)' }}>dry run</span>;
  if (record.id || record.status) {
    return (
      <span style={{ fontSize: 11, color: 'var(--gv-accent)' }}>
        posted{record.at ? ` · ${new Date(record.at).toLocaleDateString()}` : ''}
        {xId && <> · <a href={`https://x.com/i/web/status/${xId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--gv-accent)' }}>view</a></>}
      </span>
    );
  }
  return null;
}

function Channel({
  pf, value, onChange, record, published, busy, postUrl, onPost, autoShare, autoOn, onToggleAuto,
}: {
  pf: ComposerPlatform; value: string; onChange: (v: string) => void;
  record?: PublishRecord; published: boolean; busy: string | null; postUrl: string; onPost: () => void;
  autoShare: boolean; autoOn: boolean; onToggleAuto: () => void;
}) {
  const posted = !!record?.id;
  // Mirror composeShare's X budget: first tweet + two newlines + URL ≤ 280.
  const tweetLen = pf.id === 'x' ? Math.min(firstTweet(value).length, 278 - postUrl.length - 2) + 2 + postUrl.length : null;
  const canPost = published && pf.connected && !posted;
  const postHint = !pf.connected ? 'Not connected' : null;

  return (
    <div style={{ padding: '16px 18px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, opacity: pf.connected && !autoOn && !published ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--gv-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>{LABEL[pf.id].toUpperCase()}</span>
        <span style={{ fontSize: 11, color: pf.connected ? 'var(--gv-dim)' : 'var(--gv-fainter)' }}>
          {pf.connected ? (pf.handle ? `as ${pf.handle}` : 'connected') : <a href="/dashboard/connections" style={{ color: 'var(--gv-fainter)', textDecoration: 'underline' }}>not connected</a>}
        </span>
        <StatusChip record={record} xId={pf.id === 'x' ? record?.id : undefined} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {pf.id === 'x' && tweetLen !== null && (
            <span style={{ fontSize: 10.5, fontFamily: 'ui-monospace, monospace', color: tweetLen > 280 ? 'var(--gv-red-soft)' : 'var(--gv-fainter)' }}>
              first tweet {tweetLen}/280
            </span>
          )}
          {/* Pre-publish, each connected channel opts in/out of the auto fan-out. */}
          {pf.connected && !published && !posted && (
            autoShare ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ToggleSwitch on={autoOn} disabled={!!busy} onClick={onToggleAuto} />
                <span style={{ fontSize: 10.5, color: autoOn ? 'var(--gv-dim)' : 'var(--gv-fainter)' }}>
                  {autoOn ? 'posts on publish' : 'skipped on publish'}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>post manually after publishing</span>
            )
          )}
          {(canPost || (record?.error && published)) && (
            <button
              className="gv-ghost"
              onClick={onPost}
              disabled={!!busy}
              style={{ border: '1px solid rgba(99,194,129,0.3)', background: 'rgba(99,194,129,0.08)', color: 'var(--gv-accent)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
            >
              {busy === pf.id ? 'Posting…' : record?.error ? 'Retry' : 'Post now'}
            </button>
          )}
          {!canPost && !record?.error && postHint && (
            <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>{postHint}</span>
          )}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(10, Math.max(3, value.split('\n').length + 1))}
        spellCheck={false}
        style={{ width: '100%', resize: 'vertical', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.55, color: '#c4cabb' }}
      />
      <div style={{ fontSize: 11, color: 'var(--gv-fainter)', marginTop: 6 }}>{HINT[pf.id]}</div>
    </div>
  );
}

function WebhookRow({ record, published, busy, onSend }: { record?: PublishRecord; published: boolean; busy: string | null; onSend: () => void }) {
  const delivered = !!record?.status && !record.error;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14 }}>
      <span style={{ fontSize: 11, color: 'var(--gv-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>WEBHOOK</span>
      <span style={{ fontSize: 11.5, color: 'var(--gv-dim)' }}>Sends URL, cover, and every channel’s copy to your endpoint.</span>
      <StatusChip record={record} />
      <div style={{ marginLeft: 'auto' }}>
        {published && !delivered ? (
          <button
            className="gv-ghost"
            onClick={onSend}
            disabled={!!busy}
            style={{ border: '1px solid rgba(99,194,129,0.3)', background: 'rgba(99,194,129,0.08)', color: 'var(--gv-accent)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
          >
            {busy === 'webhook' ? 'Sending…' : record?.error ? 'Retry' : 'Send'}
          </button>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>{delivered ? 'delivered' : 'sends when the article publishes'}</span>
        )}
      </div>
    </div>
  );
}
