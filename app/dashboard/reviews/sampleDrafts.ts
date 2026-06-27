import type { ReviewDraftData } from './ReviewDraft';

/** The two illustrative drafts from the design comp — shown when the real review
 *  queue is empty, as a preview of the review-and-decide experience. */
export const SAMPLE_DRAFTS: ReviewDraftData[] = [
  {
    id: 'sample-1',
    title: '10 onboarding mistakes killing your activation rate',
    genre: 'Playbook', author: 'Maya Rivera', authorInitials: 'MR',
    keyword: 'ai onboarding checklist', readMin: 8, words: '1,840',
    coverBg: 'radial-gradient(120% 140% at 20% 10%, rgba(99,194,129,0.45), rgba(16,19,16,0) 55%), linear-gradient(135deg, #14241a, #0c130e)',
    score: 84, verdict: 'Clear to publish', verdictSub: 'Strong strategy fit. One stat worth adding.',
    nextSlot: 'today 6:00 PM', internalLinks: 3, sourceCount: 3, status: 'review',
    rubric: [
      { label: 'Strategy fit', value: 88 },
      { label: 'Marketing intent', value: 82 },
      { label: 'Craft & readability', value: 85 },
      { label: 'Safety & accuracy', value: 96 },
    ],
    readiness: [
      { label: 'Covers what people are searching', note: 'Matches 6 of the 8 questions people ask.', ok: true },
      { label: 'Easy for AI to quote', note: 'Has key takeaways + a real FAQ block.', ok: true },
      { label: 'Backed by real sources', note: '5 sources, 3 with 2026 data.', ok: true },
      { label: 'Sounds like you', note: 'A touch more direct than your usual — fine to keep.', ok: 'soft' },
    ],
    serp: [
      { text: 'time-to-value', ok: true }, { text: 'activation metrics', ok: true },
      { text: 'onboarding checklist', ok: true }, { text: 'in-app guidance', ok: true },
      { text: 'empty states', ok: false }, { text: 'churn correlation', ok: false },
    ],
    serpNote: '2 gaps left open on purpose — your strategy says go deeper, not wider.',
    sources: [
      { name: 'First Round — Activation benchmarks 2026', host: 'firstround.com', icon: 'globe' },
      { name: 'Reforge — Onboarding teardown', host: 'reforge.com', icon: 'book' },
      { name: 'OpenView SaaS Benchmarks', host: 'openviewpartners.com', icon: 'doc' },
    ],
    flags: [
      { code: 'MISSING_STAT_DENSITY', note: 'section 4 has no figure', dot: '#e0c878' },
      { code: 'FAQ_PRESENT', note: 'ok', dot: '#63c281' },
      { code: 'KEY_TAKEAWAYS', note: 'ok · 4 bullets', dot: '#63c281' },
    ],
    blocks: [
      { type: 'p', pre: 'Most activation problems do not start at sign-up. They start in the first ninety seconds after it — the moment a new user is staring at an empty screen, deciding whether your product is worth a second visit. ', mark: 'Teams that obsess over acquisition and ignore this window quietly lose the majority of the users they paid to get.', post: '' },
      { type: 'takeaways', items: [
        'Activation is decided in the first session, not the first week.',
        'The biggest leak is asking users to configure before they get value.',
        'A guided "first win" beats a feature tour every time.',
      ] },
      { type: 'h2', text: '1. Treating the empty state as an afterthought' },
      { type: 'p', pre: 'An empty dashboard is the most-viewed screen in your product, yet it is usually the least designed. The fix is not a cheerful illustration — it is a single, obvious next action that produces a visible result. ', mark: 'Replace "No data yet" with one button that creates the user’s first real outcome.', post: ' That one change routinely lifts day-one activation more than any onboarding email sequence.' },
      { type: 'note', text: 'You cite a stat in every other section, but this one leans on "routinely" with no number. Competitors ranking here all quote a figure. Want me to pull a benchmark from the OpenView source already in your references?', cta: 'Add a stat' },
      { type: 'h2', text: '2. Confusing a feature tour with onboarding' },
      { type: 'p', pre: 'A tooltip tour shows people where the buttons are. It does not show them why they should care. The products with the best retention skip the tour entirely and instead walk the user through completing one meaningful task end to end — what we call the ', mark: 'first win', post: '. Measure time-to-first-win, not tour completion, and optimize relentlessly against it.' },
      { type: 'faq', items: [
        { q: 'How long should onboarding take?', a: 'As long as it takes to reach the first win — usually under two minutes. Anything longer is a sign you are configuring, not activating.' },
        { q: 'Should onboarding be skippable?', a: 'Yes. Forcing a flow trains power users to resent you. Make the first win the path of least resistance instead of a wall.' },
      ] },
    ],
  },
  {
    id: 'sample-2',
    title: 'Why AI Overviews quietly rewrote the rules of B2B SEO',
    genre: 'Trend', author: 'Maya Rivera', authorInitials: 'MR',
    keyword: 'ai overviews b2b seo', readMin: 9, words: '1,930',
    coverBg: 'radial-gradient(120% 140% at 80% 10%, rgba(127,182,230,0.4), rgba(16,19,16,0) 55%), linear-gradient(135deg, #131c24, #0c130e)',
    score: 79, verdict: 'Clear to publish', verdictSub: 'Good coverage. Intro could lead harder.',
    nextSlot: 'today 6:00 PM', internalLinks: 3, sourceCount: 3, status: 'review',
    rubric: [
      { label: 'Strategy fit', value: 84 },
      { label: 'Marketing intent', value: 80 },
      { label: 'Craft & readability', value: 81 },
      { label: 'Safety & accuracy', value: 92 },
    ],
    readiness: [
      { label: 'Covers what people are searching', note: 'Matches 7 of the 9 questions people ask.', ok: true },
      { label: 'Easy for AI to quote', note: 'Answer-first openers + FAQ in place.', ok: true },
      { label: 'Backed by real sources', note: '4 sources, all from 2026.', ok: true },
      { label: 'Sounds like you', note: 'Right on voice.', ok: true },
    ],
    serp: [
      { text: 'zero-click search', ok: true }, { text: 'citation share', ok: true },
      { text: 'schema markup', ok: true }, { text: 'answer-first writing', ok: true },
      { text: 'brand mentions', ok: false }, { text: 'prompt volume', ok: false },
    ],
    serpNote: '2 gaps left open on purpose — your strategy says go deeper, not wider.',
    sources: [
      { name: 'Search Engine Land — AI Overviews study', host: 'searchengineland.com', icon: 'globe' },
      { name: 'Ahrefs — Zero-click report 2026', host: 'ahrefs.com', icon: 'doc' },
      { name: 'a16z — The answer-engine shift', host: 'a16z.com', icon: 'book' },
    ],
    flags: [
      { code: 'WEAK_OPENER', note: 'BLUF could be tighter', dot: '#e0c878' },
      { code: 'FAQ_PRESENT', note: 'ok', dot: '#63c281' },
      { code: 'SERP_GAP', note: '2 subtopics open', dot: '#e0c878' },
    ],
    blocks: [
      { type: 'p', pre: 'For fifteen years the deal was simple: rank on Google, earn the click, win the visit. ', mark: 'That deal is being quietly renegotiated, and most B2B teams have not noticed the new terms.', post: ' AI Overviews now answer the question on the results page itself — and the click you used to own may never happen.' },
      { type: 'takeaways', items: [
        'A growing share of searches end without a click — answered in-page.',
        'Being cited by the answer engine is the new page-one.',
        'Structured, answer-first content wins the citation.',
      ] },
      { type: 'h2', text: 'The click is no longer the finish line' },
      { type: 'p', pre: 'When an AI Overview summarizes three sources to answer a query, the prize shifts from the click to the citation. ', mark: 'Your goal is to be one of the sources the model quotes', post: ' — which means writing in the clear, factual, answer-first structure these systems prefer to lift.' },
      { type: 'faq', items: [
        { q: 'Does this kill traditional SEO?', a: 'No — it raises the bar. The same fundamentals win, but generic, padded content no longer survives the summary step.' },
        { q: 'How do I get cited?', a: 'Lead with the answer, back every claim with a source, and structure the page so a model can extract a clean, quotable sentence.' },
      ] },
    ],
  },
];
