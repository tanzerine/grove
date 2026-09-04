'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from './gv-icons';
import { useT } from './i18n';
import type { T } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

type Item = { href: string; label: string; icon: string; badgeKey?: string; match: (p: string) => boolean };
type Section = { head: string; items: Item[] };

/** Built per render rather than at module load: the labels are translated,
 *  and a module-level constant would freeze them at whatever locale happened
 *  to load the module first. Only the labels vary — hrefs, icons and match
 *  predicates are the same in every language. */
function sections(t: T): Section[] {
  return [
  { head: t('Create'), items: [
    { href: '/dashboard', label: t('Home'), icon: 'home', match: (p) => p === '/dashboard' },
    { href: '/dashboard/strategy', label: t('Strategy'), icon: 'strategy', match: (p) => p.startsWith('/dashboard/strategy') },
    { href: '/dashboard/write', label: t('Write'), icon: 'write', match: (p) => p.startsWith('/dashboard/write') },
    { href: '/dashboard/pipeline', label: t('Pipeline'), icon: 'pipeline', badgeKey: 'pipeline', match: (p) => p.startsWith('/dashboard/pipeline') || p.startsWith('/dashboard/posts') },
  ]},
  { head: t('Publish'), items: [
    { href: '/dashboard/calendar', label: t('Calendar'), icon: 'calendar', match: (p) => p.startsWith('/dashboard/calendar') },
    { href: '/dashboard/analytics', label: t('Analytics'), icon: 'analytics', match: (p) => p.startsWith('/dashboard/analytics') },
  ]},
  { head: t('Brand'), items: [
    { href: '/dashboard/voice', label: t('Brand voice'), icon: 'voice', match: (p) => p.startsWith('/dashboard/voice') },
    { href: '/dashboard/connections', label: t('Social'), icon: 'social', match: (p) => p.startsWith('/dashboard/connections') },
    { href: '/dashboard/embed', label: t('Embed'), icon: 'embed', match: (p) => p.startsWith('/dashboard/embed') },
    // Sits beside Embed because it answers the same question — how do grove's
    // articles reach the customer's site — for the customer who already has a
    // content layer and doesn't want a script tag.
    { href: '/dashboard/mcp', label: t('Content API'), icon: 'bolt', match: (p) => p.startsWith('/dashboard/mcp') },
  ]},
  { head: t('Account'), items: [
    { href: '/dashboard/billing', label: t('Billing'), icon: 'billing', match: (p) => p.startsWith('/dashboard/billing') },
    { href: '/dashboard/feedback', label: t('Feedback'), icon: 'voice', match: (p) => p.startsWith('/dashboard/feedback') },
  ]},
  ];
}

export default function SideNav({ badges = {}, isAdmin = false }: { badges?: Record<string, number>; isAdmin?: boolean }) {
  const pathname = usePathname() ?? '';
  const t = useT();
  const base = sections(t);
  // Admin is the operator's own area — deliberately left in English, since the
  // only person who sees it reads the code too.
  const nav = isAdmin
    ? [...base, { head: 'Admin', items: [
        { href: '/dashboard/admin', label: 'Overview', icon: 'analytics', match: (p: string) => p === '/dashboard/admin' },
        { href: '/dashboard/admin/plan', label: 'Planner', icon: 'calendar', match: (p: string) => p.startsWith('/dashboard/admin/plan') },
        { href: '/dashboard/admin/users', label: 'Users', icon: 'eye', match: (p: string) => p.startsWith('/dashboard/admin/users') },
        { href: '/dashboard/admin/refunds', label: 'Refunds', icon: 'billing', match: (p: string) => p.startsWith('/dashboard/admin/refunds') },
        { href: '/dashboard/admin/feedback', label: 'Feedback', icon: 'voice', badgeKey: 'feedback', match: (p: string) => p.startsWith('/dashboard/admin/feedback') },
        { href: '/dashboard/admin/beta', label: t('Beta codes'), icon: 'strategy', match: (p: string) => p.startsWith('/dashboard/admin/beta') },
        { href: '/dashboard/admin/outreach', label: 'Outreach', icon: 'target', match: (p: string) => p.startsWith('/dashboard/admin/outreach') },
      ] }]
    : base;
  return (
    <nav style={{ padding: '8px 18px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
      {nav.map((sec) => (
        <div key={sec.head} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--gv-fainter)', padding: '4px 12px 6px' }}>{sec.head}</div>
          {sec.items.map((it) => {
            const active = it.match(pathname);
            const badge = it.badgeKey ? badges[it.badgeKey] : 0;
            return (
              <Link key={it.href} href={it.href} className="gv-nav"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  border: `1px solid ${active ? 'rgba(162,255,1,0.22)' : 'transparent'}`,
                  background: active ? 'rgba(162,255,1,0.14)' : 'transparent',
                  color: active ? ACCENT_INK : 'var(--gv-dim)',
                  fontSize: 13.5, fontWeight: 500, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                }}>
                <span className="gv-ico" style={{ color: active ? ACCENT : 'var(--gv-faint)', display: 'flex', flexShrink: 0 }}>
                  <Icon name={it.icon} />
                </span>
                <span style={{ flex: 1 }}>{it.label}</span>
                {badge ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gv-on-accent)', background: ACCENT, borderRadius: 999, padding: '1px 7px' }}>{badge}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
