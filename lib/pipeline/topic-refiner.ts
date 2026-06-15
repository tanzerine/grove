/**
 * Topic refiner — turns a vague keyword into an insider brief.
 *
 * The user types "how to use 3d objects to make flat design more interesting".
 * That's the worst kind of input for the writer: generic, no angle, no
 * specifics. A real founder writing for their company blog would never pick
 * that title. They'd pick something like:
 *
 *   "I tested 23 3D-rendering tools on the same icon — only 4 produced
 *    something I'd ship"
 *
 * This step takes the raw topic + business profile + research context and
 * outputs a sharp brief: a strong title, a specific POV, a list of concrete
 * details the writer should reference, and the first-person opener line.
 *
 * Reference patterns (calibrated from observed great titles):
 *   - "How we [did X] without [losing Y]"             — show your work
 *   - "[Tool/feature] explained: when (and when not) to [verb]"  — opinionated guide
 *   - "Behind the [project]: why [specific choice]"   — insider story
 *   - "I tested N [things] — only M [met the bar]"    — experiment writeup
 *   - "[N] mistakes that quietly [bad outcome]"       — pain-point listicle
 *   - "[Product] is here — [concrete benefit, no hype]" — launch
 *   - "A field guide to [specific task]"              — useful, not SEO bait
 *   - "[Thing] explained: a working framework"        — opinion + structure
 *   - "What we're shipping [period] — a rough sketch" — roadmap transparency
 *   - "[Group] we love: [N] [people/things] [doing X]" — curation
 */
import { llmCall, extractJson } from '../llm';
import type { SiteProfile } from './site-profile';
import type { ResearchContext } from './research-context';

/**
 * Marketing funnel position for this article:
 *  - editorial    → pure thought-leadership, NO brand link, NO product mention.
 *                   Builds trust & SEO authority. The reader leaves smarter, not pitched.
 *  - contextual   → ONE inline brand mention as a link, woven naturally into prose.
 *                   No closing CTA. Most articles land here.
 *  - conversion   → Strong activation. Brand mentioned in lead, product referenced
 *                   as the obvious tool, and the article ends with a deliberate CTA
 *                   paragraph linking to the homepage. Use sparingly — for topics
 *                   where the product genuinely IS the answer.
 */
export type MarketingIntent = 'editorial' | 'contextual' | 'conversion';

export type RefinedBrief = {
  title: string;                       // strong, opinionated, ≤ 60 chars when possible
  angle: string;                       // one-sentence POV / thesis
  format: 'experiment' | 'guide' | 'opinion' | 'launch' | 'curation' | 'roadmap' | 'behind-the-scenes' | 'list';
  marketing_intent: MarketingIntent;   // funnel position — drives writer's marketing rules
  hook: string;                        // proposed first-person opening line
  promise: string;                     // what concrete value the reader walks away with
  must_include: string[];              // specific numbers / examples / anecdotes / refs
  faq_questions: string[];             // 3-5 real searcher questions the FAQ must answer (AEO/GEO)
  alt_titles: string[];                // 2-3 other strong options for fallback
};

const TITLE_EXAMPLES = `
EXAMPLES OF GREAT TITLES (study the patterns):
- "How we trained Oven on 800k 3D renders without losing the soul"
- "A field guide to writing prompts that bake clean icons"
- "Style memory is here — lock your brand once, forget about it"
- "Designers we love: five people changing how 3D feels in product UI"
- "GLB export, explained: when (and when not) to ship a real 3D asset"
- "Behind the rebrand: why Oven's logo is a circle and nothing else"
- "What we're shipping next quarter — a rough sketch"
- "10 onboarding mistakes quietly killing your activation rate"
- "I rebuilt our onboarding 3 times before activation moved"

PATTERNS YOU SHOULD USE:
- "How we [did X] without [losing Y]"             → show your work
- "[Thing] explained: when (and when not) to [verb]" → opinionated guide
- "Behind the [project]: why [specific choice]"   → insider story
- "I tested N [things] — only M [met the bar]"    → experiment writeup
- "[N] [mistakes/lessons/patterns] that quietly [outcome]" → pain-point list
- "[Product] is here — [concrete benefit, no hype]" → launch
- "A field guide to [specific task]"              → useful, not SEO bait
- "[Group] we love: [N] [things] [doing X]"       → curation

PATTERNS TO AVOID:
- "The ultimate guide to [X]"          — content farm bait
- "Everything you need to know about…" — too generic, no POV
- "X tips for Y"                       — listicle without specificity
- "Why X matters in 2026"              — boilerplate
- "X: a comprehensive overview"        — boring, no stance
`;

const FORMATS = `
FORMAT — pick the one that fits the topic + business:
- experiment      → "I tested N things — only M worked"; writer recounts a real or imagined comparison run
- guide           → field guide / working framework; opinionated rules, not "ultimate guide"
- opinion         → strong stance; takes a position, defends it
- launch          → announces something the business does/offers; concrete benefit
- curation        → "X people/tools/patterns we love"; shoutout/list
- roadmap         → transparent share of what's next, hedging honestly
- behind-the-scenes → process story; how the business actually does the thing
- list            → "N mistakes/lessons/patterns" with specific examples
`;

export async function refineTopic(
  rawTopic: string,
  profile: SiteProfile,
  context: ResearchContext,
  targetKeyword?: string,
): Promise<RefinedBrief> {
  const competitorList = context.competitor.map((s) => `- ${s.title}`).join('\n') || '(none)';
  const painList = context.pain.map((s) => `- ${s.title}`).join('\n') || '(none)';
  const questionList = (context.questions ?? []).map((q) => `- ${q}`).join('\n') || '(none)';

  const system = `You are an editorial strategist. You take a vague topic and turn it
into a sharp brief for a writer — picking the strongest angle a founder
would actually choose for their company blog.

YOU MUST:
- Pick an insider POV only this business could credibly write
- Use specific numbers, names, and anecdotes where possible
- Reject generic SEO framings ("Ultimate Guide", "Everything You Need…")
- Reference at least one product/service the business actually offers
- Choose a title format from the list (see below)
- Output strict JSON, no markdown, no preamble

${TITLE_EXAMPLES}
${FORMATS}

MARKETING INTENT — pick honestly based on how naturally the product fits the topic:
- editorial   → thought-leadership where the product would be a forced fit.
                Industry trends, philosophical takes, broad craft lessons.
                The article must work without ever naming the company.
                Roughly 25% of articles. Best for opinion, roadmap, some lists.
- contextual  → the product is one good example of the thing being discussed,
                but the article's value doesn't depend on you buying it.
                Roughly 50% of articles. Best for guide, experiment, curation,
                behind-the-scenes, most lists.
- conversion  → the topic is a direct buyer question — "how do I do X?" where
                the product IS the answer for the reader's job. The article
                earns a real CTA at the end.
                Roughly 25% of articles. Best for launch, comparison guides,
                "how to do [exact thing product does]" experiments and behind-the-scenes.

If unsure, pick "contextual". Never pick "conversion" just to push the product —
only when the topic genuinely calls for it.

CRITICAL OUTPUT RULES
- One raw JSON object. No backticks. No code fences. Plain text values.
- All string values single-line — no embedded newlines.`;

  const user = `BUSINESS
Name: ${profile.business.name}
Industry: ${profile.business.industry}
What they do: ${profile.business.description}
Products / services: ${profile.business.products_services.join(', ') || 'unknown'}
Target audience: ${profile.business.target_audience}
Value props: ${profile.business.value_props.join('; ') || 'unknown'}

RAW TOPIC: "${rawTopic}"
${targetKeyword?.trim() ? `\nTARGET SEARCH KEYWORD: "${targetKeyword.trim()}" — real demand this article should rank for. Work it naturally into the title and ensure the angle satisfies that search intent. Do NOT keyword-stuff; one natural use in the title/lead is enough.\n` : ''}
CONTEXT FROM RESEARCH
Common competitor angles for this topic:
${competitorList}

Common audience pain-points around this topic:
${painList}

Real questions searchers ask (Google Autocomplete — the closest free proxy for
"People Also Ask"). Pick the 3-5 most on-topic, dedupe near-duplicates, and
rephrase into clean, natural questions for an FAQ the article will answer:
${questionList}

Pick ONE strong angle. Output:
{
  "title": "the chosen title (uses one of the proven patterns, has specificity)",
  "angle": "one-sentence POV / thesis the article defends",
  "format": "experiment | guide | opinion | launch | curation | roadmap | behind-the-scenes | list",
  "marketing_intent": "editorial | contextual | conversion",
  "hook": "the proposed first-person opener — must start with I, we, or our",
  "promise": "the concrete value the reader walks away with",
  "must_include": ["specific number, name, example, or anecdote to reference", "..."],
  "faq_questions": ["3-5 clean searcher questions the article's FAQ must answer (drawn from the list above when relevant; invent on-topic ones if the list is thin)", "..."],
  "alt_titles": ["strong alternative title 1", "strong alternative title 2"]
}`;

  const { text } = await llmCall({ system, user, maxTokens: 1200 });
  const parsed = extractJson<RefinedBrief>(text);

  // sanity: never let title fall back to raw topic; force at least one alt
  if (!parsed.title || parsed.title.toLowerCase().trim() === rawTopic.toLowerCase().trim()) {
    parsed.title = parsed.alt_titles?.[0] ?? `How ${profile.business.name} thinks about ${rawTopic}`;
  }
  if (!parsed.hook || !/^\s*(I|We|Our|My)\b/i.test(parsed.hook)) {
    parsed.hook = `I've spent the last year watching ${profile.business.target_audience} struggle with this.`;
  }
  parsed.must_include = parsed.must_include ?? [];
  parsed.alt_titles = parsed.alt_titles ?? [];

  // FAQ questions: trust the model's curated list, but fall back to the raw
  // mined questions so the writer's FAQ block + FAQPage schema never go empty.
  const normalizeQ = (q: string) => {
    const t = q.trim().replace(/\s+/g, ' ');
    return /[?]$/.test(t) || !/^(how|what|why|when|where|which|who|can|do|does|is|are|should)\b/i.test(t)
      ? t : `${t}?`;
  };
  let faqs = (Array.isArray(parsed.faq_questions) ? parsed.faq_questions : [])
    .map(normalizeQ).filter(Boolean);
  if (faqs.length < 2) {
    faqs = [...faqs, ...(context.questions ?? []).map(normalizeQ)];
  }
  // dedupe (case-insensitive) and cap at 5
  const seenQ = new Set<string>();
  parsed.faq_questions = faqs.filter((q) => {
    const k = q.toLowerCase();
    if (seenQ.has(k)) return false;
    seenQ.add(k);
    return true;
  }).slice(0, 5);

  // sanity: marketing_intent must be one of three known values
  const validIntents: MarketingIntent[] = ['editorial', 'contextual', 'conversion'];
  if (!validIntents.includes(parsed.marketing_intent as MarketingIntent)) {
    // default by format: launch leans conversion, opinion/roadmap lean editorial,
    // everything else lands at contextual.
    parsed.marketing_intent = parsed.format === 'launch'
      ? 'conversion'
      : (parsed.format === 'opinion' || parsed.format === 'roadmap')
        ? 'editorial'
        : 'contextual';
  }

  return parsed;
}
