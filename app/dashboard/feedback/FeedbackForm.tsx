'use client';
import { useState } from 'react';
import Link from 'next/link';
import { captureClient } from '@/lib/analytics/capture-client';
import {
  FEEDBACK_KINDS,
  FEEDBACK_AREAS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_LIMITS,
  FEEDBACK_MIN_BODY,
  kindConfig,
  type FeedbackKind,
} from '@/lib/feedback';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';

/**
 * The customer's side of the feedback funnel.
 *
 * Three doors, one form, because the fields overlap almost entirely and three
 * separate pages would make "I have both a compliment and a complaint" a
 * navigation problem. Which extra fields appear is driven by `kind` — and the
 * server drops anything that doesn't belong to the kind it was sent with, so
 * the tab switching here is convenience, never the enforcement.
 */
export default function FeedbackForm({
  initialKind,
  defaultName,
  isBeta,
}: {
  initialKind: FeedbackKind;
  defaultName: string;
  isBeta: boolean;
}) {
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [body, setBody] = useState('');
  const [headline, setHeadline] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState('');
  const [consent, setConsent] = useState(false);
  const [displayName, setDisplayName] = useState(defaultName);
  const [displayRole, setDisplayRole] = useState('');
  const [displayUrl, setDisplayUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<FeedbackKind | null>(null);

  const cfg = kindConfig(kind);
  const isTestimonial = kind === 'testimonial';
  const isComplaint = kind === 'complaint';
  const tooShort = body.trim().length < FEEDBACK_MIN_BODY;

  function switchKind(next: FeedbackKind) {
    setKind(next);
    setErr(null);
    // The message survives the switch on purpose: someone who starts typing
    // under "shortcoming", realises it's really a complaint and switches should
    // not be punished by losing the paragraph they just wrote.
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort || busy) return;
    setErr(null);
    setBusy(true);
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        body,
        headline: headline.trim() || undefined,
        rating: rating ?? undefined,
        area: area || undefined,
        severity: isComplaint && severity ? severity : undefined,
        consent_publish: isTestimonial ? consent : undefined,
        display_name: isTestimonial && consent ? displayName.trim() || undefined : undefined,
        display_role: isTestimonial && consent ? displayRole.trim() || undefined : undefined,
        display_url: isTestimonial && consent ? displayUrl.trim() || undefined : undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Something went wrong. Please try again.');
    captureClient('feedback_submitted', { kind, area: area || undefined });
    setSent(kind);
  }

  if (sent) {
    const done = kindConfig(sent);
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '24px 8px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(162,255,1,0.14)', color: ACCENT_INK, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>✓</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gv-ink)', margin: '0 0 8px' }}>{done.thanks}</h2>
          <p style={{ fontSize: 14.5, color: 'var(--gv-dim)', lineHeight: 1.6, maxWidth: 440, margin: '0 auto 20px' }}>
            {done.thanksBody}
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { setSent(null); setBody(''); setHeadline(''); setErr(null); }}
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: ACCENT_INK }}>
              Send something else
            </button>
            <Link href="/dashboard" style={{ color: 'var(--gv-dim)', fontSize: 14 }}>← Back to dashboard</Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* the three doors */}
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {FEEDBACK_KINDS.map((k) => {
          const on = k.kind === kind;
          return (
            <button
              key={k.kind}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => switchKind(k.kind)}
              style={{
                flex: '1 1 150px', textAlign: 'left', cursor: 'pointer', padding: '11px 14px',
                borderRadius: 11, fontFamily: 'inherit',
                background: on ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${on ? 'rgba(162,255,1,0.5)' : LINE}`,
                color: on ? 'var(--gv-ink)' : 'var(--gv-soft)',
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{k.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', marginTop: 3, lineHeight: 1.45 }}>{k.blurb}</div>
            </button>
          );
        })}
      </div>

      <form onSubmit={submit}>
        {isBeta && (
          <p style={{ fontSize: 13, color: ACCENT_INK, background: 'rgba(162,255,1,0.08)', border: '1px solid rgba(162,255,1,0.2)', borderRadius: 10, padding: '10px 14px', margin: '0 0 18px', lineHeight: 1.55 }}>
            You&apos;re on a free beta — blunt is more useful to us than polite. Nothing you write here affects
            your access.
          </p>
        )}

        <h2 style={Title}>{cfg.prompt}</h2>

        {/* overall rating — not asked of complaints, where a star rating next to
            "this broke my site" is faintly insulting */}
        {!isComplaint && (
          <div style={{ margin: '14px 0 4px' }}>
            <Label>How is Grove going overall? <Optional /></Label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(rating === n ? null : n)}
                  aria-label={`${n} out of 5`}
                  style={{
                    width: 40, height: 36, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 14, fontWeight: 600,
                    background: rating !== null && n <= rating ? ACCENT : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${rating !== null && n <= rating ? ACCENT : LINE}`,
                    color: rating !== null && n <= rating ? 'var(--gv-on-accent)' : 'var(--gv-faint)',
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* which part of the product */}
        <div style={{ margin: '18px 0 4px' }}>
          <Label>{isTestimonial ? 'What stood out most?' : 'Which part of Grove?'} <Optional /></Label>
          <select value={area} onChange={(e) => setArea(e.target.value)} style={selectStyle}>
            <option value="">Choose one…</option>
            {FEEDBACK_AREAS.map((a) => (
              <option key={a.code} value={a.code}>{a.label}</option>
            ))}
          </select>
        </div>

        {/* how bad is it — complaints only */}
        {isComplaint && (
          <div style={{ margin: '18px 0 4px' }}>
            <Label>How bad is it?</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {FEEDBACK_SEVERITIES.map((s) => {
                const on = severity === s.code;
                return (
                  <button key={s.code} type="button" onClick={() => setSeverity(s.code)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer',
                      padding: '11px 14px', borderRadius: 11, fontFamily: 'inherit',
                      background: on ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${on ? 'rgba(162,255,1,0.5)' : LINE}`,
                      color: on ? 'var(--gv-ink)' : 'var(--gv-soft)',
                    }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? ACCENT : 'var(--gv-fainter)'}`, background: on ? ACCENT : 'transparent' }} />
                    <span style={{ fontSize: 14 }}>{s.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>{s.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* the message */}
        <div style={{ margin: '18px 0 4px' }}>
          <Label>{isTestimonial ? 'In your own words' : 'Tell us what happened'}</Label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder={cfg.placeholder}
            maxLength={FEEDBACK_LIMITS.body}
            style={textArea}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--gv-fainter)', marginTop: 5 }}>
            <span>{isComplaint ? 'This goes straight to Grove’s owner.' : ''}</span>
            <span>{body.length}/{FEEDBACK_LIMITS.body}</span>
          </div>
        </div>

        {/* consent + credit — testimonials only */}
        {isTestimonial && (
          <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: `1px solid ${LINE}` }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--gv-accent)', width: 15, height: 15 }} />
              <span style={{ fontSize: 13.5, color: 'var(--gv-soft)', lineHeight: 1.55 }}>
                Grove may quote this publicly — on the site, in a post, or in an ad. We&apos;ll use your words as
                written and never edit them into something you didn&apos;t say.
              </span>
            </label>

            {consent && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <Label>Credit it to</Label>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name" maxLength={FEEDBACK_LIMITS.displayName} style={inputStyle} />
                </div>
                <div>
                  <Label>Title & company <Optional /></Label>
                  <input value={displayRole} onChange={(e) => setDisplayRole(e.target.value)}
                    placeholder="Founder, Acme" maxLength={FEEDBACK_LIMITS.displayRole} style={inputStyle} />
                </div>
                <div>
                  <Label>Link to your site <Optional /></Label>
                  <input value={displayUrl} onChange={(e) => setDisplayUrl(e.target.value)}
                    placeholder="https://acme.com" maxLength={FEEDBACK_LIMITS.displayUrl} style={inputStyle} />
                </div>
                <div>
                  <Label>A one-line version <Optional /></Label>
                  <input value={headline} onChange={(e) => setHeadline(e.target.value)}
                    placeholder="Three posts a week without touching a draft."
                    maxLength={FEEDBACK_LIMITS.headline} style={inputStyle} />
                  <p style={{ fontSize: 11.5, color: 'var(--gv-fainter)', margin: '5px 0 0' }}>
                    If you leave this blank we&apos;ll quote what you wrote above, unedited.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {err && <p style={{ fontSize: 13.5, color: 'var(--gv-red-text)', margin: '16px 0 0' }}>{err}</p>}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 22, flexWrap: 'wrap' }}>
          <Link href="/dashboard" style={{ color: 'var(--gv-dim)', fontSize: 14 }}>← Back to dashboard</Link>
          <button type="submit" disabled={tooShort || busy}
            style={{
              padding: '11px 20px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
              fontSize: 14.5, fontWeight: 600, cursor: tooShort || busy ? 'default' : 'pointer',
              background: tooShort || busy ? 'rgba(255,255,255,0.08)' : ACCENT,
              color: tooShort || busy ? 'var(--gv-faint)' : 'var(--gv-on-accent)',
            }}>
            {busy ? 'Sending…' : cfg.cta}
          </button>
        </div>
      </form>
    </Shell>
  );
}

/* ─────────────────────────────── bits ───────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 16, padding: '26px 28px' }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 7 }}>
      {children}
    </label>
  );
}

function Optional() {
  return <span style={{ fontWeight: 400, color: 'var(--gv-fainter)' }}>· optional</span>;
}

const Title: React.CSSProperties = {
  fontSize: 19, fontWeight: 700, color: 'var(--gv-ink)', margin: '0 0 2px', letterSpacing: '-0.01em',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: `1px solid ${LINE}`,
  background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 14,
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const textArea: React.CSSProperties = {
  ...inputStyle, lineHeight: 1.6, resize: 'vertical', minHeight: 120,
};
