/**
 * One illustration, on demand — Flux Schnell → Supabase Storage → public URL.
 *
 * Two callers share this:
 *  - the pipeline's inline-image step, which picks sections itself and asks for
 *    an image per section (`lib/pipeline/inline-images.ts`)
 *  - the Write editor's image tool, where the author asks for a picture at the
 *    cursor while drafting (`/api/images/illustration`)
 *
 * Both go through `generateIllustration` so the model, bucket, timeout and
 * failure behaviour can't drift. `createIllustration` adds the LLM art-director
 * pass the editor needs (an author types "the funnel", not a Flux prompt).
 *
 * Returns null on ANY failure — an image is never worth failing a draft over;
 * the caller reports it and the author carries on writing.
 */
import Replicate from 'replicate';
import { llmCall } from '../llm';
import { supabaseAdmin } from '../supabase/admin';
import {
  ILLUSTRATION_STYLE,
  buildIllustrationPrompt,
  fallbackSubject,
  illustrationBrief,
  sanitizeAlt,
  type IllustrationContext,
} from './prompt';

const FLUX_MODEL = 'black-forest-labs/flux-schnell' as const;
const BUCKET = process.env.COVER_BUCKET ?? 'post-covers';
const FLUX_TIMEOUT_MS = 90_000;

/** Pull raw bytes out of a Replicate output item (v1 file objects or a URL). */
async function toImageBytes(first: any): Promise<Uint8Array | null> {
  if (typeof first?.blob === 'function') {
    const blob = await first.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof first?.url === 'function' || typeof first === 'string') {
    const imgUrl = typeof first === 'string' ? first : first.url();
    const resolvedUrl = typeof imgUrl === 'string' ? imgUrl : (imgUrl?.toString?.() ?? '');
    const res = await fetch(resolvedUrl);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }
  return null;
}

/**
 * Render `prompt` and persist it. Replicate's own URLs expire in ~an hour, so
 * the bytes MUST be uploaded to Storage before the URL goes in a post body.
 */
export async function generateIllustration(
  prompt: string,
  opts: { prefix?: string } = {},
): Promise<string | null> {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey || !prompt.trim()) return null;

  let imageBuffer: Uint8Array | null;
  try {
    const replicate = new Replicate({ auth: apiKey });
    const result = await Promise.race([
      replicate.run(FLUX_MODEL, {
        input: {
          prompt,
          aspect_ratio: '16:9',
          output_format: 'webp',
          output_quality: 85,
          num_outputs: 1,
          go_fast: true,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Flux timeout')), FLUX_TIMEOUT_MS),
      ),
    ]);
    const first: any = Array.isArray(result) ? result[0] : result;
    if (!first) return null;
    imageBuffer = await toImageBytes(first);
    if (!imageBuffer) return null;
  } catch (err) {
    console.error('[illustration] Flux failed:', err);
    return null;
  }

  try {
    const sb = supabaseAdmin();
    const { error: bucketErr } = await sb.storage.createBucket(BUCKET, { public: true });
    if (bucketErr && !bucketErr.message.toLowerCase().includes('already exists')) return null;

    const prefix = opts.prefix ?? 'inline';
    const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(filename, imageBuffer, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadErr) {
      console.error('[illustration] upload failed:', uploadErr.message);
      return null;
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(filename);
    return pub?.publicUrl ?? null;
  } catch (err) {
    console.error('[illustration] persist failed:', err);
    return null;
  }
}

type Business = {
  name?: string;
  description?: string;
  industry?: string;
  products_services?: string[];
};

/**
 * Turn an author's rough ask into one concrete Flux prompt. Falls back to a
 * plain metaphor prompt when the LLM is unavailable — a slightly generic
 * picture beats no picture and an error toast.
 */
export async function artDirect(
  ctx: IllustrationContext,
  business: Business = {},
): Promise<string> {
  const brief = illustrationBrief(ctx);
  if (!brief.focus) return '';

  try {
    const { text } = await llmCall({
      fast: true,
      maxTokens: 260,
      system: `You are an art director writing ONE image-generation prompt for an
illustration placed inside a blog article, rendered by Flux Schnell.

Write ONE sentence (25-55 words, no quotes, no markdown, no lists) describing:
- SUBJECT: a concrete visual metaphor for the idea given, built from objects the
  reader recognizes from their own work (panels, layers, tools, diagrams, parts).
- COMPOSITION: one focal point, generous negative space, landscape.
- MATERIALS & LIGHT: soft, tactile, restrained.
Never include text, letters, numbers, logos, readable UI copy, people or faces.
Describe the subject only — the house style is appended separately.`,
      user: `BUSINESS: ${business.name || '(unknown)'} — ${business.description || business.industry || '(unknown)'}
PRODUCTS / SERVICES: ${(business.products_services ?? []).slice(0, 4).join(', ') || '(unknown)'}

ARTICLE TITLE: ${ctx.title || '(untitled)'}
SECTION: ${ctx.heading || '(none)'}
ILLUSTRATE (${brief.source}): ${brief.focus}

Write the image prompt now.`,
    });
    const subject = text.trim().replace(/^["']|["']$/g, '');
    return buildIllustrationPrompt(subject || fallbackSubject(brief), ILLUSTRATION_STYLE);
  } catch {
    return buildIllustrationPrompt(fallbackSubject(brief), ILLUSTRATION_STYLE);
  }
}

export type Illustration = { url: string; alt: string; prompt: string };

/** Art-direct → render → persist. The whole editor image tool in one call. */
export async function createIllustration(
  ctx: IllustrationContext,
  business: Business = {},
): Promise<Illustration | null> {
  const prompt = await artDirect(ctx, business);
  if (!prompt) return null;
  const url = await generateIllustration(prompt, { prefix: 'inline' });
  if (!url) return null;
  const brief = illustrationBrief(ctx);
  return { url, alt: sanitizeAlt(brief.focus || ctx.title || 'Illustration'), prompt };
}
