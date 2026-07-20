import React from 'react';
import AccountAvatarMenu from './AccountAvatarMenu';
import OnboardingBell from './OnboardingBell';
import NavAutopilot from './NavAutopilot';

/** The fixed, consistent right half of EVERY page's sticky topbar: the autopilot
 *  toggle, the notifications bell (onboarding guide + live activity), and the
 *  account menu (billing, admin, site, home, log out). */
export function HeaderRight() {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
      <NavAutopilot />
      <span style={{ width: 1, height: 26, background: 'rgba(15,23,18,0.08)' }} />
      <OnboardingBell />
      <AccountAvatarMenu />
    </div>
  );
}

/**
 * The one header every dashboard page renders, so the nav bar is structurally
 * identical across the app: page-specific title (or breadcrumb via `left`) on the
 * left, the fixed bell + account cluster on the right. Page-specific controls
 * (search, autopilot, etc.) live in the body BELOW this bar — not inside it.
 */
export function DashHeader({ title, subtitle, left }: { title?: string; subtitle?: string; left?: React.ReactNode }) {
  return (
    <header className="gv-header">
      {left ?? (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginTop: 1 }}>{subtitle}</div> : null}
        </div>
      )}
      <HeaderRight />
    </header>
  );
}

/** A standard card surface used across pages. */
export function card(extra: React.CSSProperties = {}): React.CSSProperties {
  return { background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, ...extra };
}
