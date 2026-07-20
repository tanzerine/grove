import './globals.css';
import type { Metadata } from 'next';

import { SITE } from '@/lib/site';
import { appBase } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(appBase()),
  title: {
    default: SITE.title,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [...SITE.keywords],
  applicationName: SITE.name,
  // NOTE: no site-wide `alternates.canonical` here — it would cascade to every
  // route (privacy, blog, …). Canonicals are set per-page.
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap"
          rel="stylesheet"
        />
        {/* Inter is the one typeface everywhere — landing, blog, dashboard,
            auth, onboarding, legal. DM Mono (kickers/labels/code) and
            Newsreader (blog article serif accents) keep their distinct
            roles. GT Walsheim (self-hosted, see app/globals.css) is
            reserved for the single biggest title on a page. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Preload so GT Walsheim is ready before first paint on any page
            that uses it — self-hosted, tiny (27KB), cheap everywhere. */}
        <link rel="preload" href="/fonts/GTWalsheim-Medium.otf" as="font" type="font/otf" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
