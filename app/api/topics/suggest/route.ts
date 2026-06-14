import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { fastLlmCall } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Template fallback (instant, no API) ─────────────────────────────────────
type Vars = { name: string; product: string; audience: string; industry: string; value: string; year: number };

const TEMPLATES: Array<(v: Vars) => string> = [
  (v) => `How to get started with ${v.product} in under an hour`,
  (v) => `How ${v.audience} can use ${v.product} to save time every week`,
  (v) => `5 mistakes ${v.audience} make with ${v.product} (and how to fix them)`,
  (v) => `${v.product} vs the alternatives: an honest breakdown for ${v.audience}`,
  (v) => `Behind the scenes: how ${v.name} delivers ${v.value}`,
  (v) => `The ${v.year} guide to ${v.product} for ${v.audience}`,
  (v) => `Why most ${v.audience} get ${v.industry} wrong — and what to do instead`,
  (v) => `How to evaluate ${v.industry} tools: a checklist for ${v.audience}`,
  (v) => `What we learned from our first 100 ${v.audience} customers`,
  (v) => `The state of ${v.industry} in ${v.year}: what's actually changing`,
  (v) => `${v.product} explained: the plain-English guide for ${v.audience}`,
  (v) => `Is ${v.product} right for you? An honest self-assessment`,
];

function buildVars(biz: any, hostname: string): Vars {
  return {
    name:     biz?.name                         ?? hostname,
    product:  (biz?.products_services ?? [])[0] ?? biz?.description ?? hostname,
    audience: biz?.target_audience              ?? 'growing businesses',
    industry: biz?.industry                     ?? 'software',
    value:    (biz?.value_props ?? [])[0]       ?? 'quality and speed',
    year:     new Date().getFullYear(),
  };
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function templateTopics(biz: any, hostname: string, used: Set<string>, focus = ''): string[] {
  const v = buildVars(biz, hostname);
  const seed = Math.floor(Date.now() / 1000);
  // When the author gave a focus, lead with topics built around it so the
  // offline fallback still feels responsive to what they typed.
  const focused = focus
    ? [
        `A practical guide to ${focus} for ${v.audience}`,
        `${focus}: what ${v.audience} get wrong (and how to fix it)`,
        `How ${v.name} thinks about ${focus}`,
      ]
    : [];
  const generic = shuffle(TEMPLATES, seed).map((fn) => fn(v));
  return [...focused, ...generic]
    .filter((t) => !used.has(t.toLowerCase().slice(0, 40)))
    .slice(0, 6);
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get('domain_id');
  if (!domainId) return NextResponse.json({ error: 'missing domain_id' }, { status: 400 });

  // Optional steer from the writing desk: a theme, product angle, or question
  // the author wants the ideas to orbit. Capped so it can't blow the prompt.
  const focus = (searchParams.get('focus') ?? '').trim().slice(0, 200);

  const { data: domain } = await sb
    .from('domains').select('site_profile, hostname').eq('id', domainId).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const biz = (domain.site_profile as any)?.business;

  const { data: recent } = await sb
    .from('posts').select('topic, meta_title').eq('domain_id', domainId)
    .not('status', 'eq', 'failed').order('created_at', { ascending: false }).limit(30);
  const used = new Set(
    (recent ?? []).map((p: any) => (p.meta_title || p.topic || '').toLowerCase().slice(0, 40))
  );

  // ── Try fast LLM (Llama 3.2 3B, ~3–6s), fall back to templates ──────────
  try {
    const system = `You generate blog topic ideas. Output ONLY a valid JSON array of 6 strings.
No markdown. No explanation. No preamble. Just the array:
["topic 1", "topic 2", "topic 3", "topic 4", "topic 5", "topic 6"]`;

    const user_msg = [
      `Business: ${biz?.name ?? domain.hostname}`,
      `Industry: ${biz?.industry ?? 'unknown'}`,
      `Product/service: ${(biz?.products_services ?? []).join(', ') || biz?.description || 'unknown'}`,
      `Target audience: ${biz?.target_audience ?? 'businesses'}`,
      `Top value prop: ${(biz?.value_props ?? [])[0] ?? 'quality'}`,
      used.size ? `\nAvoid topics similar to:\n${[...used].slice(0, 10).join('\n')}` : '',
      focus ? `\nThe author wants these ideas centered on: "${focus}". Keep every topic clearly related to this angle.` : '',
      `\nGenerate 6 specific, search-intent blog topics. Mix formats: how-to, comparison, mistakes, behind-scenes, opinion, list.`,
    ].join('\n');

    const { text } = await fastLlmCall({ system, user: user_msg, maxTokens: 300 });

    const start = text.indexOf('[');
    const end   = text.lastIndexOf(']');
    if (start === -1 || end <= start) throw new Error('no array found');

    const suggestions: string[] = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(suggestions) || suggestions.length === 0) throw new Error('empty');

    return NextResponse.json({ suggestions: suggestions.slice(0, 6), source: 'llm' });
  } catch (err: any) {
    console.warn('[suggest] fast LLM failed, using templates:', err?.message ?? err);
    return NextResponse.json({
      suggestions: templateTopics(biz, domain.hostname, used, focus),
      source: 'template',
    });
  }
}
