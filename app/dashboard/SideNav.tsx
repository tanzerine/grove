'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/dashboard/strategy',  label: 'Strategy',    match: (p: string) => p.startsWith('/dashboard/strategy') },
  { href: '/dashboard/write',     label: 'Write',       match: (p: string) => p.startsWith('/dashboard/write') },
  { href: '/dashboard',           label: 'Pipeline',    match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/posts') },
  { href: '/dashboard/calendar',  label: 'Calendar',    match: (p: string) => p.startsWith('/dashboard/calendar') },
  { href: '/dashboard/reviews',   label: 'Reviews',     match: (p: string) => p.startsWith('/dashboard/reviews') },
  { href: '/dashboard/analytics', label: 'Analytics',   match: (p: string) => p.startsWith('/dashboard/analytics') },
  { href: '/dashboard/voice',     label: 'Brand voice', match: (p: string) => p.startsWith('/dashboard/voice') },
  { href: '/dashboard/connections', label: 'Social',    match: (p: string) => p.startsWith('/dashboard/connections') },
  { href: '/dashboard/embed',     label: 'Embed',       match: (p: string) => p.startsWith('/dashboard/embed') },
];

export default function SideNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 20 }}>
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        return (
          <Link key={it.href} href={it.href} className={`sb-item ${active ? 'on' : ''}`}>
            <span className="ic" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
