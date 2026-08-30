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
import { firstTweet, xLen, X_MAX, X_URL_WEIGHT } from '@/lib/social/compose';
import Icon from '../../gv-icons';
import { useT } from '../../i18n';
import { msg } from '@/lib/i18n';

type ChannelKey = 'x' | 'linkedin';
type PublishRecord = { id?: string; at?: string; status?: number; error?: string; dry_run?: boolean };

export type ComposerPlatform = { id: ChannelKey; handle: string | null; connected: boolean };

const LABEL: Record<ChannelKey, string> = { x: 'X', linkedin: 'LinkedIn' };
/** English source strings; translated at the render site (see lib/i18n). */
const HINT: Record<ChannelKey, string> = {
  x: msg('First line becomes the tweet; the link (23 chars on X) is appended. Over 280 is trimmed at a word break.'),
  linkedin: msg('Posted as-is with the article attached as a link card.'),
};

export default function SocialComposer({
  postId, domainId, published, social, socialPublished, platforms, autoShare, hasWebhook,
}: {
  postId: string;
  domainId: string;
  published: boolean;
  social: Partial<Record<ChannelKey, string>> & { disabled?: string[] };
  socialPublished: Record<string, PublishRecord>;
  platforms: ComposerPlatform[];
  autoShare: boolean;
  hasWebhook: boolean;
}) {
  const t = useT();
  const r = useRouter();
  const [drafts, setDrafts] = useState<Record<ChannelKey, string>>({
    x: social.x ?? '', linkedin: social.linkedin ?? '',
  });
  const [auto, setAuto] = useState(autoShare);
  const [off, setOff] = useState<Set<ChannelKey>>(
    () => new Set((social.disabled ?? []) as ChannelKey[]),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<ChannelKey | 'webhook'>('x');

  const outletCount = platforms.filter((p) => p.connected).length + (hasWebhook ? 1 : 0);

  // Drafts count too: right after generation the copy lives only in local
  // state until router.refresh() lands (and must survive it failing).
  const hasCopy = !!(social.x || social.linkedin)
    || !!(drafts.x || drafts.linkedin);
  const dirty = useMemo(
    () => (['x', 'linkedin'] as ChannelKey[]).some((k) => drafts[k] !== (social[k] ?? '')),
    [drafts, social],
  );

  async function generate() {
    if (hasCopy && dirty && !confirm(t('Regenerating replaces your edits. Continue?'))) return;
    setBusy('generate'); setNote(null);
    try {
      const res = await fetch(`/api/posts/${postId}/social`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ ok: false, text: `Couldn't write social posts: ${j.error ?? 'unknown error'}` });
        return;
      }
      // Pull the fresh copy straight into the textareas; refresh syncs the rest.
      if (j.social) setDrafts({ x: j.social.x ?? '', linkedin: j.social.linkedin ?? '' });
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
      if (!res.ok) { setNote({ ok: false, text: t('Saving the copy failed — try again.') }); return false; }
      setNote({ ok: true, text: t('Copy saved.') });
      r.refresh();
      return true;
    } catch {
      setNote({ ok: false, text: t('Saving the copy failed — try again.') });
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
      setNote({ ok: false, text: t('Sharing failed: the request didn’t complete — try again.') });
    } finally {
      setBusy(null);
    }
  }

  const ghost: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: 'pointer' };
  const primary: React.CSSProperties = { ...ghost, border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontWeight: 700 };

  const draftedCount = (['x', 'linkedin'] as ChannelKey[]).filter((k) => (drafts[k] ?? '').trim()).length;
  const activePf = platforms.find((pf) => pf.id === tab);
  const tabDot = (key: ChannelKey | 'webhook'): string | null => {
    const rec = socialPublished[key];
    if (!rec) return null;
    if (rec.error) return 'var(--gv-red)';
    if (rec.id || rec.status) return 'var(--gv-accent)';
    return null;
  };

  return (
    <div style={{ marginTop: 34 }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--gv-ink)' }}>{t('Social posts')}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: auto && outletCount > 0 ? 'var(--gv-dim)' : 'var(--gv-faint)' }}>
          <ToggleSwitch on={auto && outletCount > 0} disabled={outletCount === 0} onClick={toggleAutoShare} />
          {t('Auto-share on publish')}
        </label>
        <span style={{ fontSize: 11, color: 'var(--gv-fainter)' }}>
          {outletCount === 0
            ? <><a href="/dashboard/connections" style={{ color: 'var(--gv-dim)', textDecoration: 'underline' }}>{t('Connect an account')}</a> to enable.</>
            : auto
              ? published ? 'was applied at publish.' : 'each channel can opt out below.'
              : 'off — post each channel yourself.'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {hasCopy && <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>{draftedCount} drafted post{draftedCount === 1 ? '' : 's'}</span>}
          {hasCopy && dirty && (
            <button className="gv-btn" style={primary} onClick={save} disabled={!!busy}>
              {busy === 'save' ? t('Saving…') : t('Save copy')}
            </button>
          )}
          <button className="gv-tool" style={{ ...ghost, display: 'inline-flex', alignItems: 'center', gap: 7 }} onClick={generate} disabled={!!busy}>
            <Icon name="refresh" size={13} /> {busy === 'generate' ? t('Writing…') : hasCopy ? t('Regenerate all') : t('Write social posts')}
          </button>
        </div>
      </div>

      {note && (
        <div style={{ marginBottom: 12, fontSize: 12.5, borderRadius: 10, padding: '9px 13px', background: note.ok ? 'rgba(162,255,1,0.08)' : 'rgba(201,127,127,0.08)', border: `1px solid ${note.ok ? 'rgba(162,255,1,0.24)' : 'rgba(201,127,127,0.3)'}`, color: note.ok ? 'var(--gv-accent)' : 'var(--gv-red-soft)' }}>
          {note.text}
        </div>
      )}

      {!hasCopy ? (
        <p style={{ fontSize: 13, color: 'var(--gv-dim)', margin: '4px 0', lineHeight: 1.6 }}>
          No channel copy yet. Grove writes a native post for each platform from this article —
          an X hook and a LinkedIn post — which you can edit before anything goes out.
        </p>
      ) : (
        <>
          {/* channel tabs */}
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--gv-line)', borderRadius: 10, marginBottom: 14, width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
            {platforms.map((pf) => {
              const on = tab === pf.id;
              const dot = tabDot(pf.id);
              return (
                <button
                  key={pf.id}
                  className="gv-tab"
                  onClick={() => setTab(pf.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: on ? 'var(--gv-accent)' : 'transparent', color: on ? 'var(--gv-on-accent)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer' }}
                >
                  {LABEL[pf.id]}
                  {dot && !on && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />}
                </button>
              );
            })}
            {hasWebhook && (
              <button
                className="gv-tab"
                onClick={() => setTab('webhook')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: tab === 'webhook' ? 'var(--gv-accent)' : 'transparent', color: tab === 'webhook' ? 'var(--gv-on-accent)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer' }}
              >
                Webhook
                {tabDot('webhook') && tab !== 'webhook' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: tabDot('webhook')! }} />}
              </button>
            )}
          </div>

          {/* active channel */}
          {tab === 'webhook' && hasWebhook ? (
            <WebhookPanel record={socialPublished.webhook} published={published} busy={busy} onSend={() => postNow('webhook')} />
          ) : activePf ? (
            <Channel
              pf={activePf}
              value={drafts[activePf.id]}
              onChange={(v) => setDrafts((d) => ({ ...d, [activePf.id]: v }))}
              record={socialPublished[activePf.id]}
              published={published}
              busy={busy}
              onPost={() => postNow(activePf.id)}
              autoShare={auto}
              autoOn={!off.has(activePf.id)}
              onToggleAuto={() => toggleChannel(activePf.id)}
            />
          ) : null}
        </>
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
      <span style={{ fontSize: 11, color: 'var(--gv-accent-ink)' }}>
        posted{record.at ? ` · ${new Date(record.at).toLocaleDateString()}` : ''}
        {xId && <> · <a href={`https://x.com/i/web/status/${xId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--gv-accent-ink)' }}>view</a></>}
      </span>
    );
  }
  return null;
}

function Channel({
  pf, value, onChange, record, published, busy, onPost, autoShare, autoOn, onToggleAuto,
}: {
  pf: ComposerPlatform; value: string; onChange: (v: string) => void;
  record?: PublishRecord; published: boolean; busy: string | null; onPost: () => void;
  autoShare: boolean; autoOn: boolean; onToggleAuto: () => void;
}) {
  const t = useT();
  const posted = !!record?.id;
  // The REAL weighted length X will see: first tweet + '\n\n' (2) + link (23).
  // Uncapped on purpose — over 280 must show red, that's the whole warning.
  const tweetLen = pf.id === 'x' ? xLen(firstTweet(value)) + 2 + X_URL_WEIGHT : null;
  const canPost = published && pf.connected && !posted;
  const postHint = !pf.connected ? t('Not connected') : null;

  return (
    <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: '18px 22px 16px', opacity: pf.connected && !autoOn && !published ? 0.75 : 1 }}>
      {/* meta line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--gv-faint)' }}>
        <span>
          {pf.connected
            ? <>{pf.handle ? `as ${pf.handle}` : 'connected'} · {posted ? 'posted' : 'draft'}</>
            : <a href="/dashboard/connections" style={{ color: 'var(--gv-fainter)', textDecoration: 'underline' }}>not connected</a>}
        </span>
        <StatusChip record={record} xId={pf.id === 'x' ? record?.id : undefined} />
        {pf.id === 'x' && tweetLen !== null && (
          <span
            title={tweetLen > X_MAX ? t('Over X’s limit — the tweet will be trimmed at a word break. Shorten the first line to control the cut.') : undefined}
            style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: 'ui-monospace, monospace', color: tweetLen > X_MAX ? 'var(--gv-red-soft)' : 'var(--gv-fainter)' }}
          >
            first tweet {tweetLen}/{X_MAX}{tweetLen > X_MAX ? ' — will trim' : ''}
          </span>
        )}
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(12, Math.max(4, value.split('\n').length + 1))}
        spellCheck={false}
        style={{ width: '100%', resize: 'vertical', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.7, color: '#dfe4da' }}
      />

      {/* footer: hint + channel controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--gv-fainter)', flex: 1, minWidth: 180 }}>{t(HINT[pf.id])}</span>
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
            style={{ border: '1px solid rgba(162,255,1,0.3)', background: 'rgba(162,255,1,0.08)', color: 'var(--gv-accent-ink)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
          >
            {busy === pf.id ? t('Posting…') : record?.error ? t('Retry') : t('Post now')}
          </button>
        )}
        {!canPost && !record?.error && postHint && (
          <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>{postHint}</span>
        )}
      </div>
    </div>
  );
}

function WebhookPanel({ record, published, busy, onSend }: { record?: PublishRecord; published: boolean; busy: string | null; onSend: () => void }) {
  const t = useT();
  const delivered = !!record?.status && !record.error;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: '18px 22px' }}>
      <span style={{ fontSize: 12.5, color: 'var(--gv-dim)' }}>{t('Sends URL, cover, and every channel’s copy to your endpoint.')}</span>
      <StatusChip record={record} />
      <div style={{ marginLeft: 'auto' }}>
        {published && !delivered ? (
          <button
            className="gv-ghost"
            onClick={onSend}
            disabled={!!busy}
            style={{ border: '1px solid rgba(162,255,1,0.3)', background: 'rgba(162,255,1,0.08)', color: 'var(--gv-accent-ink)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
          >
            {busy === 'webhook' ? t('Sending…') : record?.error ? t('Retry') : t('Send')}
          </button>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--gv-fainter)' }}>{delivered ? t('delivered') : t('sends when the article publishes')}</span>
        )}
      </div>
    </div>
  );
}
