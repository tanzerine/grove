import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { fastLlmCall } from '@/lib/llm';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { languageForDomain, languageCommand, language, type LangCode } from '@/lib/language';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Template fallback (instant, no API) ─────────────────────────────────────
type Vars = { name: string; product: string; audience: string; industry: string; value: string; year: number };

/**
 * Offline fallback titles, per publication language.
 *
 * These are TITLES — a suggestion the owner queues becomes an article, so they
 * have to be in the language the blog publishes in, not the one the owner
 * reads grove in. An English template on a Korean blog hands the writer an
 * English headline and the whole article drifts with it.
 */
const TEMPLATES_BY_LANG: Record<LangCode, Array<(v: Vars) => string>> = {
  en: [
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
  ],
  ko: [
    (v) => `${v.product} 시작하기: 한 시간이면 충분합니다`,
    (v) => `${v.audience}가 ${v.product}로 매주 시간을 아끼는 방법`,
    (v) => `${v.audience}가 ${v.product}에서 자주 하는 실수 5가지와 해결법`,
    (v) => `${v.product} vs 대안: ${v.audience}를 위한 솔직한 비교`,
    (v) => `비하인드: ${v.name}이 ${v.value}를 만들어내는 방법`,
    (v) => `${v.year}년 ${v.audience}를 위한 ${v.product} 가이드`,
    (v) => `${v.audience} 대부분이 ${v.industry}를 잘못 이해하는 이유`,
    (v) => `${v.industry} 도구 고르는 법: ${v.audience}용 체크리스트`,
    (v) => `첫 고객 100명에게서 배운 것`,
    (v) => `${v.year}년 ${v.industry}, 실제로 달라지고 있는 것`,
    (v) => `${v.product} 쉽게 설명하기: ${v.audience}를 위한 안내`,
    (v) => `${v.product}, 정말 나에게 맞을까? 솔직한 자가진단`,
  ],
  es: [
    (v) => `Cómo empezar con ${v.product} en menos de una hora`,
    (v) => `Cómo ${v.audience} pueden usar ${v.product} para ahorrar tiempo cada semana`,
    (v) => `5 errores que ${v.audience} cometen con ${v.product} (y cómo corregirlos)`,
    (v) => `${v.product} frente a las alternativas: una comparación honesta para ${v.audience}`,
    (v) => `Entre bastidores: cómo ${v.name} entrega ${v.value}`,
    (v) => `La guía ${v.year} de ${v.product} para ${v.audience}`,
    (v) => `Por qué la mayoría de ${v.audience} se equivoca con ${v.industry}`,
    (v) => `Cómo evaluar herramientas de ${v.industry}: una checklist para ${v.audience}`,
    (v) => `Lo que aprendimos de nuestros primeros 100 clientes`,
    (v) => `El estado de ${v.industry} en ${v.year}: qué está cambiando de verdad`,
    (v) => `${v.product} explicado: la guía clara para ${v.audience}`,
    (v) => `¿Es ${v.product} para ti? Una autoevaluación honesta`,
  ],
  zh: [
    (v) => `一小时内上手 ${v.product}`,
    (v) => `${v.audience} 如何用 ${v.product} 每周省下时间`,
    (v) => `${v.audience} 使用 ${v.product} 常犯的 5 个错误（以及怎么改）`,
    (v) => `${v.product} 与其他方案对比：写给 ${v.audience} 的实话`,
    (v) => `幕后：${v.name} 如何做到 ${v.value}`,
    (v) => `${v.year} 年 ${v.audience} 的 ${v.product} 指南`,
    (v) => `为什么大多数 ${v.audience} 都误解了 ${v.industry}`,
    (v) => `如何评估 ${v.industry} 工具：给 ${v.audience} 的清单`,
    (v) => `我们从前 100 位客户身上学到的事`,
    (v) => `${v.year} 年的 ${v.industry}：真正在变的是什么`,
    (v) => `讲清楚 ${v.product}：写给 ${v.audience} 的说明`,
    (v) => `${v.product} 适合你吗？一份诚实的自查`,
  ],
};

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

const FOCUSED: Record<LangCode, (v: Vars, focus: string) => string[]> = {
  en: (v, f) => [
    `A practical guide to ${f} for ${v.audience}`,
    `${f}: what ${v.audience} get wrong (and how to fix it)`,
    `How ${v.name} thinks about ${f}`,
  ],
  ko: (v, f) => [
    `${v.audience}를 위한 ${f} 실전 가이드`,
    `${f}: ${v.audience}가 놓치는 것과 바로잡는 법`,
    `${v.name}이 ${f}를 바라보는 방식`,
  ],
  es: (v, f) => [
    `Una guía práctica de ${f} para ${v.audience}`,
    `${f}: en qué se equivocan ${v.audience} (y cómo arreglarlo)`,
    `Cómo piensa ${v.name} sobre ${f}`,
  ],
  zh: (v, f) => [
    `写给 ${v.audience} 的 ${f} 实用指南`,
    `${f}：${v.audience} 常见的误区与解法`,
    `${v.name} 如何看待 ${f}`,
  ],
};

function templateTopics(biz: any, hostname: string, used: Set<string>, focus = '', lang: LangCode = 'en'): string[] {
  const v = buildVars(biz, hostname);
  const seed = Math.floor(Date.now() / 1000);
  // When the author gave a focus, lead with topics built around it so the
  // offline fallback still feels responsive to what they typed.
  const focused = focus ? FOCUSED[lang](v, focus) : [];
  const generic = shuffle(TEMPLATES_BY_LANG[lang], seed).map((fn) => fn(v));
  return [...focused, ...generic]
    .filter((t) => !used.has(t.toLowerCase().slice(0, 40)))
    .slice(0, 6);
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`llm:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get('domain_id');
  if (!domainId) return NextResponse.json({ error: 'missing domain_id' }, { status: 400 });

  // Optional steer from the writing desk: a theme, product angle, or question
  // the author wants the ideas to orbit. Capped so it can't blow the prompt.
  const focus = (searchParams.get('focus') ?? '').trim().slice(0, 200);

  const { data: domain } = await sb
    .from('domains').select('site_profile, hostname, language').eq('id', domainId).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const biz = (domain.site_profile as any)?.business;
  // Publication language, not UI language: a suggestion the owner queues
  // becomes an article, and its title is used verbatim as the brief's.
  const lang = languageForDomain(domain as any).code;

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
      // Language command first in the user turn — see lib/language.ts for why
      // the tail of a system prompt does not work with this model.
      languageCommand(lang),
      `Business: ${biz?.name ?? domain.hostname}`,
      `Industry: ${biz?.industry ?? 'unknown'}`,
      `Product/service: ${(biz?.products_services ?? []).join(', ') || biz?.description || 'unknown'}`,
      `Target audience: ${biz?.target_audience ?? 'businesses'}`,
      `Top value prop: ${(biz?.value_props ?? [])[0] ?? 'quality'}`,
      used.size ? `\nAvoid topics similar to:\n${[...used].slice(0, 10).join('\n')}` : '',
      focus ? `\nThe author wants these ideas centered on: "${focus}". Keep every topic clearly related to this angle.` : '',
      `\nGenerate 6 specific, search-intent blog topics. Mix formats: how-to, comparison, mistakes, behind-scenes, opinion, list.`,
      lang === 'en' ? '' : `Every topic must be written in ${language(lang).nativeName} — these become article titles verbatim.`,
    ].filter(Boolean).join('\n');

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
      suggestions: templateTopics(biz, domain.hostname, used, focus, lang),
      source: 'template',
    });
  }
}
