// Distilled from crossplatform saas/SAAS.md + Code.md — E-E-A-T rules baked into the writer prompt.

export const BANNED_PHRASES = [
  'Bottom line:', 'Key takeaway:', 'In conclusion', 'To wrap up',
  "Let's dive in", "Let's explore", "In today's", 'In the world of',
  'navigating the landscape', 'leveraging', 'delve', 'delve into',
  'tapestry', 'myriad', 'underscore', "It's important to note",
  "It's worth noting", "It's no secret", 'When it comes to',
  'elevate', 'unleash', 'unlock the power', 'game-changer', 'synergy',
  'robust', 'seamless', 'cutting-edge', 'next-level', 'transformative',
  'in the realm of', 'Pro tip:', 'Picture this:', "Imagine you're",
  'Have you ever wondered',
];

export const BANNED_OPENERS = ['Now,', 'Next,', 'Additionally,', 'Moreover,', 'Furthermore,', 'Indeed,', 'Notably,', 'Importantly,'];

export const RECYCLED_STATS = [
  '85% watch without sound', '85% of social video',
  'captions increase view time by 12%', '12% increase in view time',
  '66% prefer short-form', '2.5x more engagement',
];

export function qualityRulesPrompt() {
  return `
CONTENT QUALITY (E-E-A-T core — these earn rankings, not detector bypasses):
1. Experience: include at least one first-person experience line ("I tested", "I ran",
   "what I saw when I tried"). If you have no real experience, write a bracketed placeholder
   like "[INSERT EXPERIENCE: <prompt for what would go here>]" — never fabricate.
2. Trustworthiness: include at least one admission of nuance or uncertainty.
3. Authority: every numeric claim must include a primary-source URL inline as
   a markdown link [text](url). No vague "studies show".
4. Expertise: at least one specific concrete example with real names, numbers, or dates.
5. Do NOT use these recycled stats:
${RECYCLED_STATS.map((s) => `   - ${s}`).join('\n')}

PROSE PATTERN RULES (look human, not spam):
6. Every paragraph must include at least one sentence under 8 words AND one over 20 words.
7. 15-25% of sentences should start with And, But, So, or Because.
8. Use 2-4 sentence fragments per article ("Worth it." "Not always." "Every time.").
9. Use 1-2 single-sentence paragraphs for emphasis.
10. Asymmetric H2 structure: H2 sections must have DIFFERENT numbers of subsections.
11. 1-2 throwaway parenthetical thoughts per article.
12. Em dashes: maximum 2 in the entire article.

BANNED PHRASES (never use):
${BANNED_PHRASES.map((p) => `   - ${p}`).join('\n')}

BANNED SENTENCE OPENERS:
${BANNED_OPENERS.map((o) => `   - ${o}`).join('\n')}

STRUCTURAL BANS:
- Do NOT end sections with one-line summaries
- Do NOT use the "X is Y. Y is Z." rhythm pattern
- Do NOT use 3-word bulleted list items
- Do NOT use generic transition sentences — just cut to the next thought
`;
}
