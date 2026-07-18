'use client';

/**
 * "Ask the agent" — a one-line bridge from any dashboard surface into the
 * sidebar assistant. Dispatches the gv:assistant event AssistantPanel
 * listens for: the panel opens with the prompt prefilled (never auto-sent),
 * so pages get an LLM entry point without any backend of their own.
 */
import Icon from './gv-icons';

export default function AskAgent({
  prompt,
  label = 'Ask the agent',
  solid = false,
}: { prompt: string; label?: string; solid?: boolean }) {
  return (
    <button
      type="button"
      className={solid ? 'gv-btn' : 'gv-ghost'}
      onClick={() => window.dispatchEvent(new CustomEvent('gv:assistant', { detail: { prompt } }))}
      style={solid
        ? { display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 9, cursor: 'pointer' }
        : { display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid rgba(99,194,129,0.3)', background: 'rgba(99,194,129,0.06)', color: 'var(--gv-accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 9, cursor: 'pointer' }}
    >
      <Icon name="sparkle" size={13} /> {label}
    </button>
  );
}
