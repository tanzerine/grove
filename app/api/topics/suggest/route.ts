import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { llmCall } from '@/lib/llm';

export const maxDuration = 120;
// Required: this GET route reads cookies for auth — must never be statically cached
export const dynamic = 'force-dynamic';

// ── Fallback template engine ────────────────────────────────────────────────
// When the LLM is slow / unavailable, generate smart topic seeds from the
// business profile using format templates. Always returns 6 useful topics.

const FORMAT_TEMPLATES = [
  (biz: string, product: string, audience: string) =>
    `How to get started with ${product || biz} — a beginner's guide for ${audience || 'teams'}`,
  (biz: string, product: string, audience: string) =>
    `${product || biz} vs the alternatives: what ${audience || 'professionals'} should know`,
  (biz: string, product: string, audience: string) =>
    `5 mistakes ${audience || 'businesses'} make with ${product || biz} (and how to fix them)`,
  (biz: string, product: string, audience: string) =>
    `Behind the scenes: how ${biz} builds ${product || 'its product'}`,
  (biz: string, product: string, audience: string) =>
    `The ${new Date().getFullYear()} guide to ${product || biz} for ${audience || 'growing companies'}`,
  (biz: string, product: string, audience: string) =>
    `Why ${audience || 'smart teams'} are switching to ${product || biz}`,
];

function fallbackTopics(biz: any, hostname: string): string[] {
  const name = biz?.name ?? hostname;
  const product = (biz?.products_services ?? [])[0] ?? biz?.description ?? name;
  const audience = biz?.target_audience ?? 'businesses';
  return FORMAT_TEMPLATES.map((fn) => fn(name, product, audience));
}

// ── Route ───────────────────────────────────────────────────────────────────

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

  const profile = domain.site_profile as any;
  const biz = profile?.business;

  // Gather recently used topics to avoid repeats
  const { data: recent } = await sb
    .from('posts').select('topic, meta_title').eq('domain_id', domainId)
    .not('status', 'eq', 'failed').order('created_at', { ascending: false }).limit(30);
  const usedTopics = (recent ?? [])
    .map((p: any) => p.meta_title || p.topic)
    .filter(Boolean)
    .join('\n- ');

  // ── Try LLM first, fall back to templates ────────────────────────────────
  try {
    const system = `You generate blog topic ideas for a business's content pipeline.
Topics should be specific, search-intent-driven, and genuinely useful to the target audience.
Each topic is the seed for a full article — concrete enough to write 1000 words on.

Output ONLY a valid JSON array of 6 strings. No markdown, no explanation, no preamble:
["topic 1", "topic 2", "topic 3", "topic 4", "topic 5", "topic 6"]`;

    const user_msg = `Business: ${biz?.name ?? domain.hostname}
Industry: ${biz?.industry ?? 'unknown'}
What they do: ${biz?.description ?? 'unknown'}
Products/services: ${(biz?.products_services ?? []).join(', ') || 'unknown'}
Target audience: ${biz?.target_audience ?? 'unknown'}
Value props: ${(biz?.value_props ?? []).join('; ') || 'unknown'}

${usedTopics ? `Already written (avoid these):\n- ${usedTopics}\n` : ''}
Generate 6 fresh, specific blog topics. Mix formats: how-to, comparison, mistakes-to-avoid, behind-the-scenes, trend, opinion.`;

    const { text } = await llmCall({ fast: true, maxTokens: 400, system, user: user_msg });

    // Extract the JSON array from wherever it appears in the response
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) throw new Error('no array in response');
    const suggestions: string[] = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(suggestions) || suggestions.length === 0) throw new Error('empty array');

    return NextResponse.json({ suggestions: suggestions.slice(0, 6), source: 'llm' });
  } catch (err: any) {
    console.warn('[topics/suggest] LLM failed, using template fallback:', err?.message ?? err);
    // Always return something useful — never a 500
    return NextResponse.json({
      suggestions: fallbackTopics(biz, domain.hostname),
      source: 'template',
    });
  }
}
