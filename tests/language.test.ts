import { describe, it, expect } from 'vitest';
import {
  LANGUAGES, LANG_CODES, normalizeLang, language, languageForDomain, allLanguages,
  contentLength, splitSentences, readMinutes, looksCjk,
  writerLanguageRules, briefLanguageRule,
  takeawaysLabelPattern, faqHeadingPattern,
  languageVerdict, isWrongLanguage, titleIsNative, languageCommand, languageRetryCommand,
  strategyLanguageRule, autocompleteLocale, keywordVariants,
  questionVariants, questionWordPattern,
} from '../lib/language';
import { classifyIntent } from '../lib/strategy/keywords';
import { extractTakeaways } from '../lib/takeaways';
import { extractFaq } from '../lib/faq';
import { validatePost, blockingIssues } from '../lib/pipeline/validator';
import { ensureTakeaways, ensureFaqSection, ensureHomepageCta } from '../lib/pipeline/post-process';
import { postSlug } from '../lib/slug';
import { pickTitle } from '../lib/pipeline/writer';
import { genreFor, authorFor, authorIsOrg, genreLabel } from '../lib/blog-genre';

/** ~1,800 characters of Korean prose: a correctly-sized Korean article. */
const KO_PARA = '원두를 어떻게 보관하느냐가 맛의 절반을 정합니다. 저희는 같은 원두를 세 가지 방식으로 나눠 2주 동안 테스트했습니다. 결과는 분명했어요. 밀폐 용기가 이겼습니다. 하지만 조건이 있습니다.\n';
const KO_BODY = KO_PARA.repeat(24);

describe('normalizeLang', () => {
  it('accepts the known codes', () => {
    for (const c of LANG_CODES) expect(normalizeLang(c)).toBe(c);
  });

  it('folds BCP-47 regional and script forms to their base code', () => {
    expect(normalizeLang('ko-KR')).toBe('ko');
    expect(normalizeLang('zh-Hans')).toBe('zh');
    expect(normalizeLang('es_419')).toBe('es');
    expect(normalizeLang('EN-GB')).toBe('en');
  });

  it('falls back to English for anything unknown, null or empty', () => {
    expect(normalizeLang(undefined)).toBe('en');
    expect(normalizeLang(null)).toBe('en');
    expect(normalizeLang('')).toBe('en');
    expect(normalizeLang('klingon')).toBe('en');
    expect(normalizeLang(42)).toBe('en');
  });

  it('reads a domain row, including one written before migration 0037', () => {
    expect(languageForDomain({ language: 'ko' }).code).toBe('ko');
    expect(languageForDomain({}).code).toBe('en');
    expect(languageForDomain(null).code).toBe('en');
  });

  it('exposes every language to a picker, English first', () => {
    expect(allLanguages().map((l) => l.code)).toEqual(['en', 'ko', 'es', 'zh']);
  });
});

describe('registry completeness', () => {
  it('every language carries the fields the pipeline reads', () => {
    for (const l of allLanguages()) {
      expect(l.tag).toBeTruthy();
      expect(l.locale).toContain('-');
      expect(l.nativeName).toBeTruthy();
      expect(l.labels.takeaways).toBeTruthy();
      expect(l.labels.faq).toBeTruthy();
      expect(l.length.floor).toBeLessThan(l.length.target[0]);
      expect(l.length.target[1]).toBeLessThan(l.length.ceiling);
      expect(l.ctaSentence('Acme', 'https://acme.com')).toContain('](https://acme.com)');
      expect(l.orgByline('Acme')).toContain('Acme');
      expect(l.queries.competitor('coffee')).toContain('coffee');
    }
  });

  it("labels a language writes are labels it can also detect", () => {
    // Otherwise the safety net appends a second, duplicate section under the
    // one the model already wrote correctly.
    for (const l of allLanguages()) {
      expect(takeawaysLabelPattern().test(`**${l.labels.takeaways}**`)).toBe(true);
      expect(faqHeadingPattern().test(l.labels.faq)).toBe(true);
    }
  });
});

describe('contentLength', () => {
  it('counts words for latin scripts', () => {
    expect(contentLength('one two three four', 'en')).toBe(4);
    expect(contentLength('uno dos tres', 'es')).toBe(3);
  });

  it('counts non-space characters for CJK', () => {
    expect(contentLength('원두 보관법', 'ko')).toBe(5);
    expect(contentLength('咖啡 保存', 'zh')).toBe(4);
  });

  it('ignores markdown syntax and URLs, keeping link text', () => {
    const md = 'See [the study](https://example.com/a/very/long/path?x=1) for more';
    // "See the study for more" = 5 words; the URL contributes nothing.
    expect(contentLength(md, 'en')).toBe(5);
  });

  it('is why a full Korean article is no longer read as thin', () => {
    // The same body under the old English word count.
    const asWords = KO_BODY.split(/\s+/).filter(Boolean).length;
    expect(asWords).toBeLessThan(LANGUAGES.en.length.floor);      // would have flagged
    expect(contentLength(KO_BODY, 'ko')).toBeGreaterThan(LANGUAGES.ko.length.floor);
  });
});

describe('splitSentences', () => {
  it('splits on ASCII terminators for latin scripts', () => {
    expect(splitSentences('One. Two! Three?', 'en')).toHaveLength(3);
  });

  it('splits Chinese on 。 with no following space', () => {
    expect(splitSentences('第一句。第二句。第三句。', 'zh')).toHaveLength(3);
  });

  it('handles Korean, which mixes both', () => {
    expect(splitSentences('첫 문장입니다. 둘째 문장입니다! 셋째는요?', 'ko')).toHaveLength(3);
  });
});

describe('readMinutes', () => {
  it('reads latin at words per minute and CJK at characters per minute', () => {
    expect(readMinutes('word '.repeat(450), 'en')).toBe(2);
    expect(readMinutes('글'.repeat(1000), 'ko')).toBe(2);
  });

  it('never reports zero minutes', () => {
    expect(readMinutes('hi', 'en')).toBe(1);
    expect(readMinutes('', 'ko')).toBe(1);
  });
});

describe('looksCjk', () => {
  it('recognises CJK bodies and ignores latin ones', () => {
    expect(looksCjk(KO_BODY)).toBe(true);
    expect(looksCjk('简体中文的文章内容')).toBe(true);
    expect(looksCjk('A perfectly ordinary English paragraph.')).toBe(false);
    expect(looksCjk('')).toBe(false);
  });
});

describe('prompt fragments', () => {
  it('adds nothing to the English prompts', () => {
    expect(writerLanguageRules('en')).toBe('');
    expect(briefLanguageRule('en')).toBe('');
  });

  it('names the language, its labels and its length target', () => {
    const rules = writerLanguageRules('ko');
    expect(rules).toContain('KOREAN');
    expect(rules).toContain('한국어');
    expect(rules).toContain(LANGUAGES.ko.labels.takeaways);
    expect(rules).toContain(`## ${LANGUAGES.ko.labels.faq}`);
    expect(rules).toContain(String(LANGUAGES.ko.length.target[0]));
    expect(briefLanguageRule('ko')).toContain('Korean');
  });

  it('asks CJK languages for an ASCII slug, and latin ones not to bother', () => {
    expect(writerLanguageRules('ko')).toContain('SLUG');
    expect(writerLanguageRules('zh')).toContain('SLUG');
    expect(writerLanguageRules('es')).not.toContain('SLUG');
  });
});

describe('label extraction across languages', () => {
  it('finds a Korean takeaways block', () => {
    const md = ['# 제목', '', '**핵심 요약**', '', '- 첫째 요점', '- 둘째 요점', '- 셋째 요점', '', '## 본문'].join('\n');
    expect(extractTakeaways(md)).toEqual(['첫째 요점', '둘째 요점', '셋째 요점']);
  });

  it('finds Spanish and Chinese takeaways blocks', () => {
    expect(extractTakeaways('**Puntos clave**\n\n- Uno\n- Dos')).toEqual(['Uno', 'Dos']);
    expect(extractTakeaways('**核心要点**\n\n- 第一\n- 第二')).toEqual(['第一', '第二']);
  });

  it('still finds the English ones', () => {
    expect(extractTakeaways('**Key takeaways**\n\n- One\n- Two')).toEqual(['One', 'Two']);
    expect(extractTakeaways('## TL;DR\n\n- One\n- Two')).toEqual(['One', 'Two']);
  });

  it('finds a Korean FAQ section', () => {
    const md = [
      '# 제목', '본문입니다.', '',
      '## 자주 묻는 질문', '',
      '### 원두는 얼마나 오래 보관할 수 있나요?',
      '개봉 후 2주 안에 마시는 것이 가장 좋습니다.',
      '',
      '### 냉동 보관은 어떤가요?',
      '소분해서 얼리면 괜찮습니다.',
    ].join('\n');
    const faqs = extractFaq(md);
    expect(faqs).toHaveLength(2);
    expect(faqs[0].question).toContain('원두');
  });

  it('finds Spanish and Chinese FAQ sections', () => {
    const es = '## Preguntas frecuentes\n\n### ¿Es real?\nSí, lo es.\n\n### ¿Y la segunda?\nTambién.';
    const zh = '## 常见问题\n\n### 这是真的吗？\n是的。\n\n### 第二个问题？\n也是。';
    expect(extractFaq(es)).toHaveLength(2);
    expect(extractFaq(zh)).toHaveLength(2);
  });
});

describe('post-processing scaffolds in the article language', () => {
  const bullets = '- 첫째 요점\n- 둘째 요점\n- 셋째 요점';

  it('splices a Korean takeaways block, not an English one', () => {
    const body = '# 제목\n\n리드 문장입니다.\n\n## 첫 번째 섹션\n\n내용.';
    const out = ensureTakeaways(body, bullets, 'ko');
    expect(out).toContain('**핵심 요약**');
    expect(out).not.toContain('Key takeaways');
    expect(extractTakeaways(out)).toHaveLength(3);
  });

  it('leaves a body that already has the block alone', () => {
    const body = '# 제목\n\n**핵심 요약**\n\n- 하나\n- 둘\n- 셋\n\n## 섹션';
    expect(ensureTakeaways(body, bullets, 'ko')).toBe(body);
  });

  it('appends the FAQ under the language\'s own heading', () => {
    const out = ensureFaqSection('# 제목\n\n본문.', '### 질문인가요?\n네, 맞습니다.', 'ko');
    expect(out).toContain('## 자주 묻는 질문');
    expect(out).not.toContain('## FAQ');
    expect(extractFaq(out)).toHaveLength(1);
  });

  it('writes the fallback CTA in the article language', () => {
    const out = ensureHomepageCta('# 제목\n\n본문입니다. Acme 이야기.', {
      businessName: 'Acme', hostname: 'acme.com', intent: 'conversion', lang: 'ko',
    });
    expect(out).toContain('](https://acme.com)');
    expect(out).not.toContain('the next time you hit this wall');
  });

  it('does not staple a second CTA under a Korean one that already links home', () => {
    const withCta = '# 제목\n\n본문.\n\n같은 문제를 겪고 있다면 [Acme](https://acme.com)를 열어보세요.';
    expect(ensureHomepageCta(withCta, {
      businessName: 'Acme', hostname: 'acme.com', intent: 'conversion', lang: 'ko',
    })).toBe(withCta);
  });

  it('English behaviour is unchanged', () => {
    const out = ensureTakeaways('# T\n\nLead.\n\n## Section\n\nBody.', '- One\n- Two\n- Three');
    expect(out).toContain('**Key takeaways**');
  });
});

describe('validator in another language', () => {
  const koArticle = [
    '# 원두 보관법: 2주간 직접 테스트한 결과',
    '',
    '**핵심 요약**',
    '',
    '- 밀폐 용기가 가장 오래 향을 지킵니다',
    '- 냉동은 소분했을 때만 유효합니다',
    '- 분쇄 후에는 어떤 방법도 오래가지 않습니다',
    '',
    KO_BODY,
    '',
    '저희는 같은 원두로 세 가지 방식을 직접 테스트했습니다.',
    '자세한 수치는 [로스터 협회 자료](https://example.com/study)에서 확인했고,',
    '두 번째 근거는 [2026년 조사](https://example.org/survey)입니다.',
    '',
    '## 자주 묻는 질문',
    '',
    '### 원두는 얼마나 보관할 수 있나요?',
    '개봉 후 2주 안에 마시는 것이 가장 좋습니다. 그 뒤로는 향이 눈에 띄게 떨어집니다.',
    '',
    '### 냉동 보관은 어떤가요?',
    '한 번 마실 양으로 소분해 얼리면 괜찮습니다. 꺼냈다 넣기를 반복하면 오히려 나빠집니다.',
  ].join('\n');

  const issues = (lang: 'en' | 'ko') =>
    validatePost(koArticle, { lang, title: '원두 보관법: 2주간 직접 테스트한 결과' }).issues.join(' | ');

  it('does not call a full Korean article thin', () => {
    expect(issues('ko')).not.toContain('THIN_CONTENT');
    // …which it would have been, graded as English.
    expect(issues('en')).toContain('THIN_CONTENT');
  });

  it('sees the Korean takeaways and FAQ', () => {
    expect(issues('ko')).not.toContain('MISSING_KEY_TAKEAWAYS');
    expect(issues('ko')).not.toContain('MISSING_FAQ');
  });

  it('recognises Korean first-person experience', () => {
    expect(issues('ko')).not.toContain('MISSING_EXPERIENCE');
    expect(issues('en')).toContain('MISSING_EXPERIENCE');
  });

  it('reports length in the language\'s own unit', () => {
    const v = validatePost('짧음.', { lang: 'ko' });
    expect(v.issues.join(' ')).toContain('characters');
  });
});

describe('slugs', () => {
  it('uses the writer\'s ASCII hint when the title has no ASCII at all', () => {
    expect(postSlug('원두 보관법', 'abc12345', 'how-to-store-coffee-beans'))
      .toBe('how-to-store-coffee-beans');
  });

  it('still prefers the title when it can be slugified', () => {
    expect(postSlug('Storing beans', 'abc12345', 'ignored-hint')).toBe('storing-beans');
  });

  it('falls back to the id when there is no hint either', () => {
    expect(postSlug('원두 보관법', 'abc12345')).toBe('post-abc12345');
    expect(postSlug('원두 보관법', 'abc12345', '  ')).toBe('post-abc12345');
  });

  it('sanitizes a hint that came back dirty', () => {
    expect(postSlug('', null, 'How To Store: Coffee Beans!')).toBe('how-to-store-coffee-beans');
  });

  it('Spanish titles need no hint — accents fold', () => {
    expect(postSlug('Cómo guardar el café', 'abc12345')).toBe('como-guardar-el-cafe');
  });
});

describe('genre + byline', () => {
  it('translates the genre label but keeps the id stable', () => {
    expect(genreFor('guide', null, 'ko')).toEqual({ id: 'guide', label: '가이드' });
    expect(genreFor('guide', null, 'es').id).toBe('guide');
    expect(genreFor('guide', null, 'zh').label).toBe('指南');
    expect(genreFor('guide', null).label).toBe('Guide');
  });

  it('falls back to the article genre for an unknown id', () => {
    expect(genreLabel('not-a-genre', 'ko')).toBe('아티클');
  });

  it('picks up title heuristics in other languages', () => {
    expect(genreFor(null, 'Cómo guardar el café', 'es').id).toBe('guide');
    expect(genreFor(null, '如何保存咖啡豆', 'zh').id).toBe('guide');
    expect(genreFor(null, 'Por qué el tueste oscuro está sobrevalorado', 'es').id).toBe('opinion');
  });

  it('writes the org byline in the blog\'s language', () => {
    const profile = { business: { name: 'Acme' } };
    expect(authorFor(profile, 'acme.com')).toBe('Acme Team');
    expect(authorFor(profile, 'acme.com', 'ko')).toBe('Acme 팀');
    expect(authorFor(profile, 'acme.com', 'es')).toBe('Equipo de Acme');
  });

  it('a founder byline is never translated', () => {
    const profile = { business: { name: 'Acme', founder: '이태윤' } };
    expect(authorFor(profile, 'acme.com', 'ko')).toBe('이태윤');
    expect(authorIsOrg(profile)).toBe(false);
  });

  it('asks the profile whether the byline is an organization, not the string', () => {
    // `author.endsWith('Team')` was the old test — false for "Acme 팀".
    expect(authorIsOrg({ business: { name: 'Acme' } })).toBe(true);
    expect(authorIsOrg(null)).toBe(true);
  });
});

describe('reader chrome', () => {
  it('every language fills in every UI string', () => {
    const en = Object.keys(LANGUAGES.en.ui).sort();
    for (const l of allLanguages()) {
      expect(Object.keys(l.ui).sort(), `${l.code} ui keys`).toEqual(en);
      for (const [k, v] of Object.entries(l.ui)) {
        expect(typeof v === 'function' ? v('X' as never) : v, `${l.code}.${k}`).toBeTruthy();
      }
    }
  });

  it('keeps grove out of the reader-facing strings it has no business in', () => {
    expect(language('ko').ui.readTime(5)).toContain('5');
    expect(language('zh').ui.pageOf(2, 7)).toContain('7');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   The regression this file exists for: grove's first Korean-configured
   article came back entirely in English. Every stage had read `ko` correctly
   — the models simply ignored a directive sitting at the tail of a long
   English system prompt, and the manager then flagged the one correct Korean
   sentence in the draft (the appended CTA) as a defect and had it removed.
   ───────────────────────────────────────────────────────────────────────── */

const EN_ARTICLE = [
  '# The 6-Second 3D Asset: How Product Teams Save Hours on Icon Design',
  '',
  'We tested this across four sprints. The results were not subtle.',
  'Design teams spend more time exporting icons than designing them.',
].join('\n').concat(' Every product team hits this wall eventually and nobody talks about it.'.repeat(12));

describe('languageVerdict — the check that does not trust a prompt', () => {
  it('catches the exact failure that shipped: a ko blog, an English draft', () => {
    expect(languageVerdict(EN_ARTICLE, 'ko')).toBe('wrong');
    expect(isWrongLanguage(EN_ARTICLE, 'ko')).toBe(true);
  });

  it('passes a genuinely Korean article', () => {
    expect(languageVerdict(KO_BODY, 'ko')).toBe('ok');
    expect(isWrongLanguage(KO_BODY, 'ko')).toBe(false);
  });

  it('separates Korean from Chinese', () => {
    const zh = '如何保存咖啡豆。我们用三种方式做了两周的测试。结果很清楚。'.repeat(12);
    expect(languageVerdict(zh, 'zh')).toBe('ok');
    expect(languageVerdict(zh, 'ko')).toBe('wrong');
    expect(languageVerdict(KO_BODY, 'zh')).toBe('wrong');
  });

  it('flags a CJK body on an English blog', () => {
    expect(languageVerdict(KO_BODY, 'en')).toBe('wrong');
    expect(languageVerdict(EN_ARTICLE, 'en')).toBe('ok');
  });

  it('judges Spanish on function-word density, not script', () => {
    const es = 'Guardamos el café de la misma forma que lo hacen los tostadores, porque el aire es el problema. '.repeat(12);
    expect(languageVerdict(es, 'es')).toBe('ok');
    expect(languageVerdict(EN_ARTICLE, 'es')).toBe('wrong');
  });

  it('abstains rather than guessing on a short body', () => {
    expect(languageVerdict('Too short to judge.', 'ko')).toBe('unsure');
    expect(languageVerdict('', 'es')).toBe('unsure');
    expect(isWrongLanguage('Too short to judge.', 'ko')).toBe(false);
  });
});

describe('WRONG_LANGUAGE is blocking', () => {
  it('flags an English draft on a Korean blog and gates publication', () => {
    const v = validatePost(EN_ARTICLE, { lang: 'ko' });
    expect(v.issues.join(' ')).toContain('WRONG_LANGUAGE');
    // Blocking, so autopilot routes it to review instead of publishing it.
    expect(blockingIssues(v).some((i) => i.startsWith('WRONG_LANGUAGE'))).toBe(true);
  });

  it('says nothing when the draft is in the right language', () => {
    expect(validatePost(KO_BODY, { lang: 'ko' }).issues.join(' ')).not.toContain('WRONG_LANGUAGE');
    expect(validatePost(EN_ARTICLE, { lang: 'en' }).issues.join(' ')).not.toContain('WRONG_LANGUAGE');
  });
});

describe('the canonical title cannot be an English one on a Korean article', () => {
  const KO_TITLE = '3D 아이콘 디자인, 매주 10시간을 아끼는 방법';
  const EN_TITLE = 'The 6-Second 3D Asset: How Product Teams Save 10+ Hours a Week';
  const KO_ARTICLE_MD = `# ${KO_TITLE}\n\n본문입니다.`;

  it('prefers the brief title when it is already native', () => {
    expect(pickTitle(KO_TITLE, 'ignored', KO_ARTICLE_MD, 'ko')).toBe(KO_TITLE);
  });

  it('drops an English brief title in favour of the model\'s Korean one', () => {
    // This is the second half of the shipped bug: forceCanonicalH1 would have
    // stamped the refiner's English headline onto a correct Korean article.
    expect(pickTitle(EN_TITLE, KO_TITLE, KO_ARTICLE_MD, 'ko')).toBe(KO_TITLE);
  });

  it('falls back to the H1 the writer actually wrote', () => {
    expect(pickTitle(EN_TITLE, 'Another English One', KO_ARTICLE_MD, 'ko')).toBe(KO_TITLE);
  });

  it('keeps the brief title when nothing native is available', () => {
    expect(pickTitle(EN_TITLE, '', '# Also English', 'ko')).toBe(EN_TITLE);
  });

  it('English and Spanish are unaffected — the brief always wins', () => {
    expect(pickTitle(EN_TITLE, 'model title', '# H1', 'en')).toBe(EN_TITLE);
    expect(pickTitle('Cómo guardar el café', 'otro', '# H1', 'es')).toBe('Cómo guardar el café');
  });
});

describe('titleIsNative', () => {
  it('answers for CJK and abstains for latin scripts', () => {
    expect(titleIsNative('원두 보관법', 'ko')).toBe(true);
    expect(titleIsNative('How to store beans', 'ko')).toBe(false);
    expect(titleIsNative('如何保存咖啡豆', 'zh')).toBe(true);
    expect(titleIsNative('Cómo guardar el café', 'es')).toBe(true);   // can't tell, so yes
    expect(titleIsNative('', 'ko')).toBe(false);
  });
});

describe('the directive that goes first in the user prompt', () => {
  it('is empty for English and emphatic otherwise', () => {
    expect(languageCommand('en')).toBe('');
    expect(languageCommand('ko')).toContain('한국어');
    expect(languageCommand('ko')).toContain('KOREAN');
  });

  it('tells the model the English brief is not a licence to write English', () => {
    expect(languageCommand('ko')).toMatch(/brief|topic|sources/i);
  });

  it('the retry command names the failure outright', () => {
    expect(languageRetryCommand('ko')).toContain('NOT IN KOREAN');
    expect(languageRetryCommand('ko')).toContain('한국어');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   The strategy layer: one artifact, two languages, plus the keyword research
   that was silently English no matter what the blog published in.
   ───────────────────────────────────────────────────────────────────────── */

describe('strategyLanguageRule', () => {
  it('says nothing when everything is English', () => {
    expect(strategyLanguageRule('en', 'en')).toBe('');
  });

  it('collapses to one instruction when both languages agree', () => {
    const rule = strategyLanguageRule('ko', 'ko');
    expect(rule).toContain('한국어');
    expect(rule).toContain('WHOLE PLAN');
    expect(rule).not.toContain('TWO LANGUAGES');
  });

  it('splits the plan when the blog and the owner differ', () => {
    // A Korean founder selling to Americans: English titles, Korean reasoning.
    const rule = strategyLanguageRule('en', 'ko');
    expect(rule).toContain('TWO LANGUAGES');
    expect(rule).toMatch(/pillar titles, slot titles, target keywords/);
    expect(rule).toMatch(/goals[\s\S]*한국어|한국어[\s\S]*goals/);
  });

  it('keeps enum fields out of it in every form', () => {
    for (const [pub, ui] of [['ko', 'ko'], ['en', 'ko'], ['ko', 'en']] as const) {
      expect(strategyLanguageRule(pub, ui)).toContain('Enum-valued fields');
    }
  });
});

describe('keyword research follows the blog, not the machine', () => {
  it('asks Google for suggestions in the blog language', () => {
    // hl was hardcoded to 'en', so a Korean blog's plan chased English demand.
    expect(autocompleteLocale('ko')).toBe('ko');
    expect(autocompleteLocale('zh')).toBe('zh');   // zh-Hans → zh
    expect(autocompleteLocale('en')).toBe('en');
  });

  it('expands a seed with the language\'s own modifiers', () => {
    const ko = keywordVariants('원두', 'ko');
    expect(ko).toContain('원두 방법');
    expect(ko.join(' ')).not.toContain('how to');
    expect(keywordVariants('beans', 'en')).toContain('how to beans');
    expect(keywordVariants('café', 'es')).toContain('cómo café');
  });

  it('mines questions with the interrogative where the language puts it', () => {
    expect(questionVariants('원두', 'ko')).toContain('원두 방법');
    expect(questionVariants('beans', 'en')).toContain('what is beans');
    // Korean and Chinese put it at the end, so the matcher can't anchor at ^.
    expect(questionWordPattern('ko').test('원두 보관 방법')).toBe(true);
    expect(questionWordPattern('en').test('원두 보관 방법')).toBe(false);
    expect(questionWordPattern('en').test('how to store beans')).toBe(true);
  });
});

describe('classifyIntent across languages', () => {
  it('reads Korean commercial and transactional vocabulary', () => {
    expect(classifyIntent('원두 가격', 'ko')).toBe('transactional');
    expect(classifyIntent('원두 추천', 'ko')).toBe('commercial');
    expect(classifyIntent('로그인', 'ko')).toBe('navigational');
    expect(classifyIntent('원두 보관 방법', 'ko')).toBe('informational');
  });

  it('still reads English words inside a Korean query', () => {
    // Product names and "best"/"vs" turn up in Korean queries constantly, so
    // English is a second pass rather than being replaced.
    expect(classifyIntent('best 커피 그라인더', 'ko')).toBe('commercial');
  });

  it('is unchanged for English', () => {
    expect(classifyIntent('buy coffee beans')).toBe('transactional');
    expect(classifyIntent('best coffee grinder')).toBe('commercial');
    expect(classifyIntent('how to store beans')).toBe('informational');
  });

  it('classified every Korean keyword as informational before this', () => {
    // The regression in one line: the English patterns match nothing in Korean,
    // so the plan lost its commercial/transactional balance entirely.
    const koCommercial = ['원두 추천', '그라인더 비교', '캡슐 후기'];
    expect(koCommercial.map((k) => classifyIntent(k, 'en'))).toEqual(
      ['informational', 'informational', 'informational'],
    );
    expect(koCommercial.map((k) => classifyIntent(k, 'ko'))).toEqual(
      ['commercial', 'commercial', 'commercial'],
    );
  });
});
