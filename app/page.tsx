import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  if (sp.code) redirect(`/auth/callback?code=${sp.code}`);
  return <Landing />;
}
