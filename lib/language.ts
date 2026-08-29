/**
 * Publication language — the single source for "what language is this blog
 * written in", and for every consequence of that answer.
 *
 * Before this file the pipeline had no language input at all. Prompts were
 * English, the scaffolding spliced in after the model ("**Key takeaways**",
 * "## FAQ", the closing CTA sentence) was English, the validator measured
 * length with `split(/\s+/)`, and the reader chrome was English literals in
 * four different files. A Korean article was possible only by accident, and it
 * would have come out with English headings stapled onto Korean prose.
 *
 * So everything that varies by language lives here, keyed by code:
 *   - what the model is told to write (writerLanguageRules / briefLanguageRule)
 *   - what the mechanical safety nets write into the body (labels, ctaSentence)
 *   - what those safety nets look FOR before writing (detect patterns — an
 *     article that already says 핵심 요약 must not get "Key takeaways" added)
 *   - how a draft's length and sentence rhythm are measured (length, sentences)
 *   - what the reader surfaces say and tag themselves as (ui, tag, locale)
 *
 * Pure and dependency-free: unit-tested in tests/language.test.ts, safe to
 * import from server components, route handlers, and the pipeline alike.
 */

export type LangCode = 'en' | 'ko' | 'es' | 'zh';

export const LANG_CODES: readonly LangCode[] = ['en', 'ko', 'es', 'zh'] as const;

/**
 * How a draft's length is measured.
 *
 * Latin scripts count whitespace-delimited words. CJK counts non-space
 * characters instead: Chinese has no word spaces at all (a full article scores
 * a few dozen "words"), and Korean eojeol carry roughly 1.7 English words each,
 * so a properly-sized Korean article reads as thin on an English floor. The
 * CJK targets below are the English targets converted at ~2 characters per
 * English word, which is the ratio Korean and Chinese translations of the same
 * source text actually land on.
 */
export type LengthModel = {
  unit: 'word' | 'char';
  /** Below this the draft is flagged THIN_CONTENT. */
  floor: number;
  /** Above this it's flagged OVERLONG. */
  ceiling: number;
  /** The range the writer is briefed to hit. */
  target: [number, number];
  /** Human phrasing for prompts and flags ("words" / "characters"). */
  unitLabel: string;
};

/** Reader-facing chrome. Every public blog surface pulls its labels from here. */
export type ReaderUi = {
  allArticles: string;
  by: (author: string) => string;
  readTime: (minutes: number) => string;
  updated: (date: string) => string;
  imageCredit: string;
  share: string;
  copyLink: string;
  copied: string;
  keepReading: string;
  onThisPage: string;
  tableOfContents: string;
  poweredBy: (business: string) => string;
  tryBusiness: (business: string) => string;
  visitBusiness: (business: string) => string;
  latestArticles: string;
  fromTheBlog: string;
  theBlog: string;
  loading: string;
  clear: string;
  search: string;
  noResults: string;
  /* blog index */
  blogTitle: (host: string) => string;
  tagline: string;
  searchButton: string;
  allGenres: string;
  featured: string;
  noMatch: string;
  clearFilters: string;
  reads: (n: number) => string;
  newer: string;
  older: string;
  pageOf: (a: number, b: number) => string;
};

export type Language = {
  code: LangCode;
  /** BCP-47 tag: <html lang>, JSON-LD inLanguage, RSS <language>. */
  tag: string;
  /** Intl locale for dates on reader surfaces. */
  locale: string;
  /** Name in English (admin surfaces) and its own endonym (owner picker). */
  englishName: string;
  nativeName: string;
  /** CJK scripts change how length, slugs and sentence rhythm are handled. */
  script: 'latin' | 'cjk';
  length: LengthModel;
  /** Headings the pipeline writes INTO the article body. */
  labels: {
    /** Bolded lead-in above the TL;DR bullets. */
    takeaways: string;
    /** Text of the closing `## ` FAQ heading. */
    faq: string;
  };
  /**
   * What a body that ALREADY has these sections looks like. The extractors
   * (lib/takeaways.ts, lib/faq.ts) match against every language's patterns at
   * once, not just the domain's own: a body is a body, and matching narrowly
   * would mean a Korean article's 핵심 요약 goes unseen and a second, English
   * one gets spliced in above it.
   */
  detect: { takeaways: string[]; faq: string[] };
  /** Sentence terminators — CJK uses 。！？ and rarely the ASCII stops. */
  sentenceEnd: string;
  /**
   * A sentence shorter than this counts as "short" for the rhythm check —
   * words for latin scripts, characters for CJK (same unit as `length`).
   */
  shortSentence: number;
  /**
   * Evidence of lived experience: a first-person marker next to a verb of
   * doing. The English check (`I tried/tested/ran…`) matches nothing in a
   * Korean article, which would flag every honest draft as second-hand.
   */
  firstPerson: RegExp;
  /** Closing CTA the post-processor appends when the model didn't write one. */
  ctaSentence: (business: string, url: string) => string;
  /** Byline for a business with no named founder ("Acme Team" / "Acme 팀"). */
  orgByline: (business: string) => string;
  /**
   * Research queries, in the language the article will be written in. An
   * English query returns English pages, and citing those in a Korean article
   * sends the reader somewhere they can't read — and analyses a SERP the
   * article isn't competing in.
   */
  queries: {
    competitor: (topic: string) => string;
    pain: (topic: string, audience: string) => string;
  };
  ui: ReaderUi;
};

/* ─────────────────────────── reader chrome ─────────────────────────────── */

const UI_EN: ReaderUi = {
  allArticles: '← All articles',
  by: (a) => `By ${a}`,
  readTime: (m) => `${m} min read`,
  updated: (d) => ` · updated ${d}`,
  imageCredit: 'Image',
  share: 'Share',
  copyLink: 'Copy link',
  copied: 'Copied ✓',
  keepReading: 'Keep reading',
  onThisPage: 'On this page',
  tableOfContents: 'Table of contents',
  poweredBy: (b) => `Powered by ${b}`,
  tryBusiness: (b) => `Try ${b}`,
  visitBusiness: (b) => `Visit ${b} →`,
  latestArticles: 'Latest articles',
  fromTheBlog: 'From the blog',
  theBlog: 'The blog',
  loading: 'Loading…',
  clear: 'Clear',
  search: 'Search articles',
  noResults: 'No articles found.',
  blogTitle: (h) => `The ${h} blog`,
  tagline: 'Grown by grove. Updated on autopilot.',
  searchButton: 'Search',
  allGenres: 'All',
  featured: 'FEATURED',
  noMatch: 'No articles match',
  clearFilters: 'Clear filters',
  reads: (n) => `${n} reads`,
  newer: '← Newer',
  older: 'Older →',
  pageOf: (a, b) => `Page ${a} / ${b}`,
};

const UI_KO: ReaderUi = {
  allArticles: '← 전체 글',
  by: (a) => `${a}`,
  readTime: (m) => `${m}분 분량`,
  updated: (d) => ` · ${d} 수정`,
  imageCredit: '이미지',
  share: '공유',
  copyLink: '링크 복사',
  copied: '복사됨 ✓',
  keepReading: '이어서 읽기',
  onThisPage: '목차',
  tableOfContents: '목차',
  poweredBy: (b) => `${b} 제공`,
  tryBusiness: (b) => `${b} 사용해 보기`,
  visitBusiness: (b) => `${b} 바로가기 →`,
  latestArticles: '최근 글',
  fromTheBlog: '블로그에서',
  theBlog: '블로그',
  loading: '불러오는 중…',
  clear: '지우기',
  search: '글 검색',
  noResults: '검색 결과가 없습니다.',
  blogTitle: (h) => `${h} 블로그`,
  tagline: 'grove가 자동으로 씁니다.',
  searchButton: '검색',
  allGenres: '전체',
  featured: '추천',
  noMatch: '검색 결과가 없습니다',
  clearFilters: '필터 지우기',
  reads: (n) => `${n}회 읽음`,
  newer: '← 최신',
  older: '이전 →',
  pageOf: (a, b) => `${a} / ${b} 페이지`,
};

const UI_ES: ReaderUi = {
  allArticles: '← Todos los artículos',
  by: (a) => `Por ${a}`,
  readTime: (m) => `${m} min de lectura`,
  updated: (d) => ` · actualizado el ${d}`,
  imageCredit: 'Imagen',
  share: 'Compartir',
  copyLink: 'Copiar enlace',
  copied: 'Copiado ✓',
  keepReading: 'Sigue leyendo',
  onThisPage: 'En esta página',
  tableOfContents: 'Contenido',
  poweredBy: (b) => `Con tecnología de ${b}`,
  tryBusiness: (b) => `Prueba ${b}`,
  visitBusiness: (b) => `Ir a ${b} →`,
  latestArticles: 'Últimos artículos',
  fromTheBlog: 'Del blog',
  theBlog: 'El blog',
  loading: 'Cargando…',
  clear: 'Limpiar',
  search: 'Buscar artículos',
  noResults: 'No se encontraron artículos.',
  blogTitle: (h) => `El blog de ${h}`,
  tagline: 'Cultivado por grove. Actualizado en piloto automático.',
  searchButton: 'Buscar',
  allGenres: 'Todos',
  featured: 'DESTACADO',
  noMatch: 'No hay artículos que coincidan',
  clearFilters: 'Quitar filtros',
  reads: (n) => `${n} lecturas`,
  newer: '← Más recientes',
  older: 'Más antiguos →',
  pageOf: (a, b) => `Página ${a} / ${b}`,
};

const UI_ZH: ReaderUi = {
  allArticles: '← 全部文章',
  by: (a) => `${a}`,
  readTime: (m) => `阅读约 ${m} 分钟`,
  updated: (d) => ` · ${d} 更新`,
  imageCredit: '图片',
  share: '分享',
  copyLink: '复制链接',
  copied: '已复制 ✓',
  keepReading: '继续阅读',
  onThisPage: '本页目录',
  tableOfContents: '目录',
  poweredBy: (b) => `由 ${b} 提供`,
  tryBusiness: (b) => `试试 ${b}`,
  visitBusiness: (b) => `前往 ${b} →`,
  latestArticles: '最新文章',
  fromTheBlog: '来自博客',
  theBlog: '博客',
  loading: '加载中…',
  clear: '清除',
  search: '搜索文章',
  noResults: '没有找到文章。',
  blogTitle: (h) => `${h} 博客`,
  tagline: '由 grove 自动撰写与更新。',
  searchButton: '搜索',
  allGenres: '全部',
  featured: '精选',
  noMatch: '没有匹配的文章',
  clearFilters: '清除筛选',
  reads: (n) => `${n} 次阅读`,
  newer: '← 更新',
  older: '更早 →',
  pageOf: (a, b) => `第 ${a} / ${b} 页`,
};

/* ───────────────────────────── the registry ────────────────────────────── */

export const LANGUAGES: Record<LangCode, Language> = {
  en: {
    code: 'en',
    tag: 'en',
    locale: 'en-US',
    englishName: 'English',
    nativeName: 'English',
    script: 'latin',
    length: { unit: 'word', floor: 800, ceiling: 1900, target: [900, 1400], unitLabel: 'words' },
    labels: { takeaways: 'Key takeaways', faq: 'FAQ' },
    detect: {
      takeaways: ['key takeaways', 'takeaways', 'tl;dr', 'tldr', 'the short version', 'in short'],
      faq: ['faq', 'faqs', 'frequently asked', 'common questions', 'q&a'],
    },
    sentenceEnd: '.!?',
    shortSentence: 12,
    firstPerson: /\b(?:I|we) (?:tried|tested|ran|saw|noticed|found|built|used|shipped|measured)\b/i,
    ctaSentence: (b, url) =>
      `If this is the kind of work you're shipping, that's the gap we built [${b}](${url}) to close — open it the next time you hit this wall.`,
    orgByline: (b) => `${b} Team`,
    queries: {
      competitor: (t) => `best tools alternatives ${t}`,
      pain: (t, a) => `${t} mistakes problems pitfalls ${a}`,
    },
    ui: UI_EN,
  },

  ko: {
    code: 'ko',
    tag: 'ko',
    locale: 'ko-KR',
    englishName: 'Korean',
    nativeName: '한국어',
    script: 'cjk',
    // ~2 characters per English word: an 800-word floor is ~1,600 characters.
    length: { unit: 'char', floor: 1500, ceiling: 3600, target: [1700, 2700], unitLabel: 'characters' },
    labels: { takeaways: '핵심 요약', faq: '자주 묻는 질문' },
    detect: {
      takeaways: ['핵심 요약', '핵심요약', '요점 정리', '요점정리', '한눈에 보기', '세 줄 요약'],
      faq: ['자주 묻는 질문', '자주묻는질문', '질문과 답변', '독자 질문'],
    },
    sentenceEnd: '.!?。！？',
    shortSentence: 35,
    firstPerson: /(?:저희|우리|제가|내가)[^.\n]{0,60}(?:했|봤|썼|만들|테스트|측정|겪|배웠|부딪)/,
    ctaSentence: (b, url) =>
      `이런 작업을 매일 하고 있다면, 바로 그 지점을 메우려고 만든 것이 [${b}](${url})입니다. 다음에 같은 벽에 부딪힐 때 열어보세요.`,
    orgByline: (b) => `${b} 팀`,
    queries: {
      competitor: (t) => `${t} 추천 비교 도구`,
      pain: (t, a) => `${t} 실수 문제점 주의사항 ${a}`,
    },
    ui: UI_KO,
  },

  es: {
    code: 'es',
    tag: 'es',
    locale: 'es-ES',
    englishName: 'Spanish',
    nativeName: 'Español',
    script: 'latin',
    // Spanish runs ~20% longer than English for the same content.
    length: { unit: 'word', floor: 900, ceiling: 2200, target: [1050, 1650], unitLabel: 'palabras' },
    labels: { takeaways: 'Puntos clave', faq: 'Preguntas frecuentes' },
    detect: {
      takeaways: ['puntos clave', 'puntos claves', 'resumen rápido', 'en resumen', 'lo esencial', 'tl;dr'],
      faq: ['preguntas frecuentes', 'faq', 'preguntas comunes', 'dudas frecuentes'],
    },
    sentenceEnd: '.!?',
    shortSentence: 14,
    firstPerson: /\b(?:prob(?:é|amos)|constru(?:í|imos)|med(?:í|imos)|descubr(?:í|imos)|us(?:é|amos)|vi|vimos|not(?:é|amos))\b/i,
    ctaSentence: (b, url) =>
      `Si este es el trabajo que sacas adelante cada día, ese es justo el hueco que construimos [${b}](${url}) para cerrar: ábrelo la próxima vez que choques con este muro.`,
    orgByline: (b) => `Equipo de ${b}`,
    queries: {
      competitor: (t) => `mejores herramientas alternativas ${t}`,
      pain: (t, a) => `${t} errores problemas riesgos ${a}`,
    },
    ui: UI_ES,
  },

  zh: {
    code: 'zh',
    // zh-Hans, not bare zh: simplified is what the writer is briefed to produce,
    // and hreflang/inLanguage consumers treat the script subtag as meaningful.
    tag: 'zh-Hans',
    locale: 'zh-CN',
    englishName: 'Chinese (Simplified)',
    nativeName: '简体中文',
    script: 'cjk',
    // Chinese is the densest of the four: ~1.6 characters per English word.
    length: { unit: 'char', floor: 1300, ceiling: 3100, target: [1450, 2300], unitLabel: 'characters' },
    labels: { takeaways: '核心要点', faq: '常见问题' },
    detect: {
      takeaways: ['核心要点', '要点速览', '关键要点', '一句话总结', 'tl;dr'],
      faq: ['常见问题', '常见问答', 'faq', '读者提问'],
    },
    sentenceEnd: '.!?。！？',
    shortSentence: 30,
    firstPerson: /(?:我们|我)[^。\n]{0,60}(?:试|测|做|发现|搭建|用过|遇到|踩)/,
    ctaSentence: (b, url) =>
      `如果这正是你每天在做的事，[${b}](${url}) 就是为了补上这个缺口而做的——下次再撞上同一堵墙时，打开它。`,
    orgByline: (b) => `${b} 团队`,
    queries: {
      competitor: (t) => `${t} 工具推荐 对比`,
      pain: (t, a) => `${t} 常见错误 问题 坑 ${a}`,
    },
    ui: UI_ZH,
  },
};

/* ──────────────────────────── lookup helpers ───────────────────────────── */

/** Coerce anything (a DB column, a query param, undefined) to a known code. */
export function normalizeLang(value: unknown): LangCode {
  const v = String(value ?? '').trim().toLowerCase();
  if ((LANG_CODES as readonly string[]).includes(v)) return v as LangCode;
  // Tolerate BCP-47 regional forms — 'ko-KR', 'zh-Hans', 'es-419'.
  const base = v.split(/[-_]/)[0];
  if ((LANG_CODES as readonly string[]).includes(base)) return base as LangCode;
  return 'en';
}

/** The registry entry for a code (unknown codes fall back to English). */
export function language(code: unknown): Language {
  return LANGUAGES[normalizeLang(code)];
}

/**
 * The language of a domain row. One accessor so no caller reaches for
 * `domain.language` raw and gets `undefined` on a row read before 0035 ran.
 */
export function languageForDomain(domain: { language?: string | null } | null | undefined): Language {
  return language(domain?.language);
}

/** Every language, for pickers. English first, then alphabetical by endonym. */
export function allLanguages(): Language[] {
  return LANG_CODES.map((c) => LANGUAGES[c]);
}

/* ─────────────────────────── length + rhythm ───────────────────────────── */

const CJK_CHAR = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/** True when the text is mostly CJK, whatever the domain is configured as. */
export function looksCjk(text: string): boolean {
  const sample = (text ?? '').slice(0, 4000);
  if (!sample) return false;
  let cjk = 0;
  for (const ch of sample) if (CJK_CHAR.test(ch)) cjk++;
  return cjk / sample.length > 0.15;
}

/**
 * Measure a draft in the unit its language is graded in. Markdown syntax and
 * URLs are stripped first so a link-heavy article isn't credited for its hrefs
 * — the reader counts prose, so the floor should too.
 */
export function contentLength(body: string, lang: LangCode | Language): number {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  const prose = (body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>`|~-]/g, ' ');
  if (l.length.unit === 'char') return prose.replace(/\s+/g, '').length;
  return prose.split(/\s+/).filter(Boolean).length;
}

/** Split a body into sentences using the language's own terminators. */
export function splitSentences(body: string, lang: LangCode | Language): string[] {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  const cls = l.sentenceEnd.replace(/[\\\]^-]/g, '\\$&');
  // CJK terminators aren't followed by a space, so the split can't require one.
  const re = new RegExp(`(?<=[${cls}])\\s*`);
  return body.split(re).map((s) => s.trim()).filter(Boolean);
}

/** Reading time, in the unit the language reads at (~225 wpm / ~500 cpm). */
export function readMinutes(body: string, lang: LangCode | Language): number {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  const n = contentLength(body, l);
  return Math.max(1, Math.round(n / (l.length.unit === 'char' ? 500 : 225)));
}

/* ─────────────────────────── prompt fragments ──────────────────────────── */

/**
 * The block appended to the writer's system prompt. English returns '' on
 * purpose — the English prompt is already tuned word by word, and prepending
 * "write in English" to it is noise that costs tokens and changes nothing.
 */
export function writerLanguageRules(lang: LangCode | Language): string {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  if (l.code === 'en') return '';
  const [lo, hi] = l.length.target;
  return `
LANGUAGE — WRITE THE ENTIRE ARTICLE IN ${l.englishName.toUpperCase()} (${l.nativeName})
- Title, headings, body, takeaways, FAQ, meta title and meta description: all ${l.englishName}.
  Not one English sentence, not one English heading, not a bilingual gloss.
- Write NATIVELY, not translated. A reader must not be able to tell this was
  briefed in English: no calqued idioms, no English sentence rhythm, no
  "당신은/usted/你" address where a native writer would drop the pronoun.
- Keep proper nouns, product names, and established technical terms in their
  original form (Figma, API, SaaS). Do NOT invent local coinages for them.
- The two scaffold labels must read EXACTLY: "${l.labels.takeaways}" for the
  takeaways lead-in, and "## ${l.labels.faq}" for the closing FAQ heading.
  These are matched mechanically after you write — a translated variant means
  a duplicate section gets appended.
- LENGTH: ${lo}–${hi} ${l.length.unitLabel} for the main body (the ${l.englishName} equivalent
  of a 900–1400 word English article), plus the short FAQ.
- The PROSE RHYTHM rules above are written for English. Honour their INTENT —
  vary sentence length hard, mix short punchy lines with long ones, avoid a
  uniform formal drone — using ${l.englishName}'s own devices, and ignore their
  literal English word counts and English conjunction list.
${l.script === 'cjk' ? `- SLUG: the URL slug cannot carry ${l.englishName} characters. Supply a short
  ASCII slug (lowercase English keywords, hyphen-separated, 3–8 words) that
  describes the article — this is what the article's URL will be.` : ''}`.trim();
}

/** The one-line rule for prompts that produce short strings (titles, briefs). */
export function briefLanguageRule(lang: LangCode | Language): string {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  if (l.code === 'en') return '';
  return `- LANGUAGE: every reader-facing string you output (title, hook, angle, promise, FAQ questions) must be written in ${l.englishName} (${l.nativeName}), natively — never English, never a translation of an English phrasing. Internal field values (format, marketing_intent) stay as the enum values given.`;
}

/**
 * Language hint for the research + SERP queries. A Korean article wants Korean
 * sources: cite an English page and the reader can't open it, and the SERP the
 * article is competing in isn't the one that was analysed.
 */
export function searchLanguageHint(lang: LangCode | Language): { hl: string; suffix: string } {
  const l = typeof lang === 'string' ? LANGUAGES[normalizeLang(lang)] : lang;
  return { hl: l.tag, suffix: l.code === 'en' ? '' : ` ${l.nativeName}` };
}

/* ─────────────────── label patterns for the extractors ─────────────────── */

/** Regex-escape a literal label. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `\b` around an ASCII alternative, nothing around a CJK one — there is no
 * word boundary between 자주 and 묻는, so `\b자주` never matches.
 */
function bounded(label: string): string {
  const e = esc(label);
  return /^[\x20-\x7e]+$/.test(label) ? `\\b${e}\\b` : e;
}

function alternation(pick: (l: Language) => string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const code of LANG_CODES) {
    for (const label of pick(LANGUAGES[code])) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(bounded(label));
    }
  }
  return parts.join('|');
}

/**
 * Matches the takeaways lead-in at the START of a line, in any supported
 * language, with or without its markdown dressing (`## `, `**`, `__`).
 * Used by lib/takeaways.ts.
 */
export function takeawaysLabelPattern(): RegExp {
  // 'tl;dr' has to tolerate the optional semicolon it's written with either way.
  const alts = alternation((l) => l.detect.takeaways).replace(/tl;dr/g, 'tl;?dr');
  return new RegExp(`^\\s*(?:#{2,4}\\s*|\\*\\*\\s*|__\\s*)?(?:${alts})`, 'i');
}

/** Matches an H2 heading that opens a FAQ section. Used by lib/faq.ts. */
export function faqHeadingPattern(): RegExp {
  const alts = alternation((l) => l.detect.faq).replace(/q&a/g, 'q\\s*&\\s*a');
  return new RegExp(`(?:${alts})`, 'i');
}
