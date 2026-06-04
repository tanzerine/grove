import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// No maxDuration needed — no LLM call, responds in <100ms

// ── Topic template engine ────────────────────────────────────────────────────
// 30 format templates covering every major blog content type.
// Filled in with real business profile data, shuffled, deduped against
// existing posts, and returned instantly without any LLM call.

type Vars = {
  name: string;       // business name
  product: string;    // primary product/service
  audience: string;   // target audience
  industry: string;   // industry
  value: string;      // top value prop
  year: number;
};

const TEMPLATES: Array<(v: Vars) => string> = [
  // How-to
  (v) => `How to get started with ${v.product} in under an hour`,
  (v) => `How ${v.audience} can use ${v.product} to save time every week`,
  (v) => `How to evaluate ${v.industry} tools: a checklist for ${v.audience}`,
  (v) => `How ${v.name} approaches ${v.value} — and what you can copy`,
  (v) => `How to switch to ${v.product} without disrupting your workflow`,

  // Mistakes / pitfalls
  (v) => `5 mistakes ${v.audience} make with ${v.product} (and how to fix them)`,
  (v) => `Why most ${v.audience} get ${v.industry} wrong — and what to do instead`,
  (v) => `The biggest ${v.product} mistakes we see ${v.audience} make`,
  (v) => `Stop doing these 4 things with your ${v.industry} stack`,

  // Comparison
  (v) => `${v.product} vs the alternatives: an honest breakdown for ${v.audience}`,
  (v) => `Build vs buy: when ${v.audience} should use ${v.product}`,
  (v) => `Free vs paid ${v.industry} tools — what actually matters for ${v.audience}`,

  // Behind the scenes
  (v) => `Behind the scenes: how ${v.name} delivers ${v.value}`,
  (v) => `What we learned from our first 100 ${v.audience} customers`,
  (v) => `The tech stack behind ${v.name} (and why we chose it)`,
  (v) => `How we reduced onboarding time for ${v.audience} by 60%`,

  // Trend / opinion
  (v) => `The state of ${v.industry} in ${v.year}: what's changing and what's not`,
  (v) => `Why ${v.value} is becoming the #1 priority for ${v.audience}`,
  (v) => `The ${v.industry} trends ${v.audience} should actually care about in ${v.year}`,
  (v) => `Hot take: most ${v.industry} advice for ${v.audience} is wrong`,

  // Lists / roundups
  (v) => `The ${v.year} toolkit for ${v.audience} who care about ${v.value}`,
  (v) => `7 questions to ask before choosing a ${v.industry} solution`,
  (v) => `Our favourite ${v.industry} resources for ${v.audience} — curated`,
  (v) => `10 things ${v.audience} wish they knew before starting with ${v.product}`,

  // ROI / results
  (v) => `What does ${v.product} actually cost? A real breakdown for ${v.audience}`,
  (v) => `The ROI of ${v.value}: how ${v.audience} measure what matters`,
  (v) => `Case study: how a ${v.audience} team got results with ${v.product}`,

  // FAQ / explainer
  (v) => `${v.product} explained: the plain-English guide for ${v.audience}`,
  (v) => `The most common questions ${v.audience} ask about ${v.industry}`,
  (v) => `Is ${v.product} right for you? An honest self-assessment`,
];

function buildVars(biz: any, hostname: string): Vars {
  return {
    name:     biz?.name                     ?? hostname,
    product:  (biz?.products_services ?? [])[0] ?? biz?.description ?? biz?.name ?? hostname,
    audience: biz?.target_audience          ?? 'growing businesses',
    industry: biz?.industry                 ?? 'software',
    value:    (biz?.value_props ?? [])[0]   ?? 'quality and speed',
    year:     new Date().getFullYear(),
  };
}

// Seeded shuffle so each call returns a different rotation without repeats
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get('domain_id');
  if (!domainId) return NextResponse.json({ error: 'missing domain_id' }, { status: 400 });

  const { data: domain } = await sb
    .from('domains').select('site_profile, hostname').eq('id', domainId).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const biz = (domain.site_profile as any)?.business;
  const vars = buildVars(biz, domain.hostname);

  // Gather already-used topics to filter out close matches
  const { data: recent } = await sb
    .from('posts').select('topic, meta_title').eq('domain_id', domainId)
    .not('status', 'eq', 'failed').order('created_at', { ascending: false }).limit(30);
  const used = new Set(
    (recent ?? []).map((p: any) => (p.meta_title || p.topic || '').toLowerCase().slice(0, 40))
  );

  // Shuffle with a time-based seed so each click gives a fresh rotation
  const seed = Math.floor(Date.now() / 1000);
  const shuffled = shuffle(TEMPLATES, seed);

  const suggestions = shuffled
    .map((fn) => fn(vars))
    .filter((t) => !used.has(t.toLowerCase().slice(0, 40)))
    .slice(0, 6);

  return NextResponse.json({ suggestions });
}
