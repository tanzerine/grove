'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from './gv-icons';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

type Item = { href: string; label: string; icon: string; badgeKey?: string; match: (p: string) => boolean };
type Section = { head: string; items: Item[] };

const SECTIONS: Section[] = [
  { head: 'Create', items: [
    { href: '/dashboard', label: 'Home', icon: 'home', match: (p) => p === '/dashboard' },
    { href: '/dashboard/strategy', label: 'Strategy', icon: 'strategy', match: (p) => p.startsWith('/dashboard/strategy') },
    { href: '/dashboard/write', label: 'Write', icon: 'write', match: (p) => p.startsWith('/dashboard/write') },
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: 'pipeline', badgeKey: 'pipeline', match: (p) => p.startsWith('/dashboard/pipeline') || p.startsWith('/dashboard/posts') },
  ]},
  { head: 'Publish', items: [
    { href: '/dashboard/calendar', label: 'Calendar', icon: 'calendar', match: (p) => p.startsWith('/dashboard/calendar') },
    { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics', match: (p) => p.startsWith('/dashboard/analytics') },
  ]},
  { head: 'Brand', items: [
    { href: '/dashboard/voice', label: 'Brand voice', icon: 'voice', match: (p) => p.startsWith('/dashboard/voice') },
    { href: '/dashboard/connections', label: 'Social', icon: 'social', match: (p) => p.startsWith('/dashboard/connections') },
    { href: '/dashboard/embed', label: 'Embed', icon: 'embed', match: (p) => p.startsWith('/dashboard/embed') },
  ]},
  { head: 'Account', items: [
    { href: '/dashboard/billing', label: 'Billing', icon: 'billing', match: (p) => p.startsWith('/dashboard/billing') },
  ]},
];

export default function SideNav({ badges = {}, isAdmin = false }: { badges?: Record<string, number>; isAdmin?: boolean }) {
  const pathname = usePathname() ?? '';
  const sections = isAdmin
    ? [...SECTIONS, { head: 'Admin', items: [
        { href: '/dashboard/admin', label: 'Overview', icon: 'analytics', match: (p: string) => p === '/dashboard/admin' },
        { href: '/dashboard/admin/users', label: 'Users', icon: 'eye', match: (p: string) => p.startsWith('/dashboard/admin/users') },
        { href: '/dashboard/admin/refunds', label: 'Refunds', icon: 'billing', match: (p: string) => p.startsWith('/dashboard/admin/refunds') },
      ] }]
    : SECTIONS;
  return (
    <nav style={{ padding: '8px 18px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
      {sections.map((sec) => (
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
