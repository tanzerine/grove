import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GroveMark from '@/components/GroveMark';
import { meetingSummary, publicView, tokenFromSlug } from '@/lib/meetings';
import { meetingByToken } from '@/lib/meetings-store';
import MeetBooking from './MeetBooking';

// A meeting link: the owner's offered times for one prospect. Private by
// obscurity (a 24-character token), never indexed — same family as /r/<slug>.
// English only: it is sent to one person who wrote to us in English.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const token = tokenFromSlug((await params).slug);
  const m = token ? await meetingByToken(token) : null;
  return {
    title: { absolute: m ? `${meetingSummary(m)} · Pick a time` : 'Meeting · Grove' },
    description: 'Pick a time for a call with Grove.',
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function MeetPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const token = tokenFromSlug(slug);
  const m = token ? await meetingByToken(token) : null;
  if (!m) notFound();

  return (
    <main className="gv-auth gv-meet">
      <GroveMark />
      <MeetBooking slug={slug} initial={publicView(m)} />
    </main>
  );
}
