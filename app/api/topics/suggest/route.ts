import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { llmCall } from '@/lib/llm';

export const maxDuration = 120;

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

  const system = `You generate blog topic ideas for a business's content pipeline.
Topics should be specific, search-intent-driven, and genuinely useful to the target audience.
Each topic is the seed for a full article — it should be concrete enough to write 1000 words on.

Output ONLY valid JSON — an array of 6 topic strings, no markdown, no explanation:
["topic 1", "topic 2", ...]`;

  const user_msg = `Business: ${biz?.name ?? domain.hostname}
Industry: ${biz?.industry ?? 'unknown'}
What they do: ${biz?.description ?? 'unknown'}
Products/services: ${(biz?.products_services ?? []).join(', ') || 'unknown'}
Target audience: ${biz?.target_audience ?? 'unknown'}
Value props: ${(biz?.value_props ?? []).join('; ') || 'unknown'}

${usedTopics ? `Already written (do NOT suggest these or close variants):\n- ${usedTopics}\n` : ''}
Generate 6 fresh, specific blog topics that would perform well in search and genuinely help this audience.
Mix formats: how-to, comparison, mistakes-to-avoid, behind-the-scenes, trend analysis, opinion.`;

  try {
    const { text } = await llmCall({ fast: true, maxTokens: 400, system, user: user_msg });

    // Robust array extraction — find the first '[' ... ']' block regardless of surrounding text
    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (!arrayMatch) throw new Error('no JSON array in response');
    const suggestions: string[] = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(suggestions)) throw new Error('not an array');
    return NextResponse.json({ suggestions: suggestions.slice(0, 6) });
  } catch (err: any) {
    console.error('[topics/suggest] failed:', err?.message ?? err);
    return NextResponse.json({ error: 'generation failed' }, { status: 500 });
  }
}
