/**
 * Brand voice extractor — reads the customer's home/about/blog pages, asks
 * the model to distill a voice profile, caches it as JSON on the domain row.
 */
import { llmCall } from '../llm';
import type { Voice } from './writer';

async function fetchText(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'grove-voice/1.0' } });
    clearTimeout(t);
    if (!r.ok) return '';
    const html = await r.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 12_000);
  } catch { return ''; }
}

export async function profileVoice(hostname: string): Promise<Voice> {
  const candidates = [
    `https://${hostname}`,
    `https://${hostname}/about`,
    `https://${hostname}/blog`,
    `https://www.${hostname}`,
  ];
  const corpus = (await Promise.all(candidates.map(fetchText))).join('\n\n---\n\n').slice(0, 30_000);

  if (!corpus.trim()) {
    return {
      persona: `Owner of ${hostname}`,
      tone: 'clear, practical, confident',
      register: 'professional-conversational',
    };
  }

  const { text } = await llmCall({
    system: 'You distill a brand voice profile from website copy. Output ONLY a JSON object.',
    user: `Read the corpus below and produce a JSON voice profile:
{ "persona": "...", "tone": "...", "register": "...", "vocabulary": ["distinctive word", "..."] }

Be specific — not "professional" but "engineer-to-engineer, blunt about trade-offs".

CORPUS:
${corpus}`,
    maxTokens: 800,
    json: true,
  });

  const raw = text.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!raw) throw new Error('voice: no JSON');
  return JSON.parse(raw);
}
