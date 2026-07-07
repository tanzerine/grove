/**
 * AI-generated cover image via openai/gpt-image-2 on Replicate. This is a
 * native Replicate model — it runs on REPLICATE_API_TOKEN alone (no OpenAI key).
 *
 * Pipeline:
 *  1. LLM art-directs an image prompt from the article + business context
 *  2. gpt-image-2 renders the image
 *  3. Image is downloaded and uploaded to Supabase Storage (Replicate URLs
 *     expire after ~60 minutes, so we must persist them)
 *  4. Return the public Supabase URL + AI credit
 *
 * Required setup (one-time):
 *  - Supabase Dashboard → Storage → Create bucket "post-covers" (Public: ON)
 *
 * Env:
 *  - REPLICATE_API_TOKEN  (required — the Replicate client)
 *  - COVER_IMAGE_QUALITY  (low | medium | high, default medium)
 *
 * IMPORTANT: gpt-image-2's inputs are prompt + aspect_ratio + quality only.
 * It does NOT accept output_format — passing it makes the prediction fail,
 * which is why covers silently stopped generating. Keep the input minimal.
 *
 * Returns null on any failure — the article still publishes without a cover,
 * caller logs the reason.
 */
import Replicate from 'replicate';
import { llmCall } from '../llm';
import { supabaseAdmin } from '../supabase/admin';

const IMAGE_MODEL = (process.env.COVER_IMAGE_MODEL ?? 'openai/gpt-image-2') as `${string}/${string}`;
// low ≈ cheapest, medium = balanced quality/cost, high = pricey. Env-tunable.
const IMAGE_QUALITY = (process.env.COVER_IMAGE_QUALITY ?? 'medium') as 'low' | 'medium' | 'high';
const IMAGE_ASPECT = '3:2';   // gpt-image-2 supports 1:1, 3:2, 2:3
const BUCKET = process.env.COVER_BUCKET ?? 'post-covers';

export type Cover = {
  url: string;
  credit: { name: string; source: string; model: string };
};

const STYLE = `clean modern editorial illustration, restrained muted palette of 2-3 colors,
soft tasteful lighting, generous negative space, landscape composition,
magazine-cover quality — no text, no letters, no logos, no readable UI copy, no people, no faces`;

type PromptInput = {
  title: string;
  industry?: string;
  businessName?: string;
  businessDescription?: string;
  products?: string[];
  bodyMd?: string;
};

/**
 * Pull a short, content-rich excerpt for the image prompter: the first
 * non-heading paragraph (usually the lead/hook) + the first H2 (signals the
 * central argument). This grounds the image in the article's actual thesis,
 * not just keywords in the title.
 */
function articleEssence(bodyMd: string): string {
  if (!bodyMd) return '';
  const lines = bodyMd.split('\n');
  let lead = '';
  let firstH2 = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#\s/.test(trimmed)) continue;             // skip H1
    if (/^##\s/.test(trimmed)) {
      if (!firstH2) firstH2 = trimmed.replace(/^##\s+/, '');
      continue;
    }
    if (/^[#>\-*\d]/.test(trimmed)) continue;        // skip headings/lists/quotes
    if (!lead) lead = trimmed.replace(/[*_`]/g, '');
    if (lead && firstH2) break;
  }
  return [lead.slice(0, 320), firstH2 && `Central section: ${firstH2}`]
    .filter(Boolean).join(' ');
}

async function composePrompt(input: PromptInput): Promise<string> {
  const { title, industry = '', businessName = '', businessDescription = '', products = [], bodyMd = '' } = input;
  const essence = articleEssence(bodyMd);

  try {
    const { text } = await llmCall({
      maxTokens: 320,
      system: `You are an art director writing ONE image-generation prompt for an
editorial blog cover, rendered by a high-fidelity image model (gpt-image-2).
The cover MUST visually echo THIS article's specific argument AND fit the
business's product domain — never generic stock imagery.

Write ONE paragraph (45-75 words, no quotes/markdown/lists) that specifies, in order:
- SUBJECT: a concrete visual metaphor mapping to the article's central idea
  (e.g. a split before/after frame, stacked layers being lifted, mismatched
  parts snapping into a set). Ground it in objects the audience recognizes
  from their own work — UI panels, icons, devices, blueprints — based on the
  business description and products.
- COMPOSITION: one clear focal point with generous negative space, landscape.
- LIGHTING & MATERIALS: soft, tasteful, tactile.
Be vivid and specific about shapes, materials, and arrangement.
Do NOT include any text, letters, numbers, logos, readable UI copy, people, or faces.`,
      user: `BUSINESS: ${businessName || '(unknown)'} — ${businessDescription || industry || '(unknown)'}
PRODUCTS / SERVICES: ${products.slice(0, 4).join(', ') || '(unknown)'}

ARTICLE TITLE: "${title}"
ARTICLE ESSENCE: ${essence || '(none — infer from title)'}

Write the image prompt now.`,
    });
    const subject = text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 600);
    return `${subject} ${STYLE}`;
  } catch {
    const fallbackSubject = products[0]
      ? `visual metaphor for "${title}" rendered using ${products[0]}-style imagery`
      : `visual metaphor for "${title}" in the ${industry || 'tech'} space`;
    return `${fallbackSubject}, ${STYLE}`;
  }
}

/**
 * Full cover-image workflow for a single post: fetch via Flux Schnell,
 * upload to Supabase Storage, update the post row, append log entries.
 *
 * Designed to be called from a route handler via Next's after() so it
 * runs past the HTTP response (fire-and-forget in plain code dies on
 * Vercel serverless because the function terminates).
 */
export async function runCoverForPost(postId: string, opts: { force?: boolean } = {}): Promise<void> {
  const sb = supabaseAdmin();
  const { appendLog } = await import('./log');

  const { data: post } = await sb
    .from('posts').select('title, meta_title, body_md, cover_image_url, domains(site_profile)')
    .eq('id', postId).single();

  if (!post) { await appendLog(postId, 'cover_image', 'fail', 'post not found'); return; }

  // A retry must never re-generate an image that already exists — that's the
  // expensive, slow step the owner explicitly doesn't want redone. Only the
  // manual "regenerate cover" action passes force.
  if (!opts.force && (post as any).cover_image_url) {
    await appendLog(postId, 'cover_image', 'done', 'kept existing cover');
    return;
  }

  await appendLog(postId, 'cover_image', 'start');

  const title = (post as any).meta_title || (post as any).title || '';
  const biz = (post as any).domains?.site_profile?.business ?? {};
  const bodyMd: string = (post as any).body_md ?? '';
  if (!title) { await appendLog(postId, 'cover_image', 'fail', 'no title'); return; }

  try {
    const cover = await fetchCoverImage({
      title,
      industry: biz.industry ?? '',
      businessName: biz.name ?? '',
      businessDescription: biz.description ?? '',
      products: biz.products_services ?? [],
      bodyMd,
    });
    if (!cover) {
      await appendLog(postId, 'cover_image', 'done', 'no image generated');
      return;
    }

    // Inject the image naturally into the article body after the H1
    const currentBody: string = (post as any).body_md ?? '';
    const updatedBody = injectCoverIntoBody(currentBody, cover.url, title);

    await sb.from('posts').update({
      cover_image_url: cover.url,
      cover_image_credit: cover.credit,
      body_md: updatedBody,
    }).eq('id', postId);
    await appendLog(postId, 'cover_image', 'done', cover.credit.name);
  } catch (err: any) {
    await appendLog(postId, 'cover_image', 'fail', String(err?.message ?? err));
  }
}

/** Pull the raw bytes out of a Replicate output item. v1 returns file-like
 *  objects with .blob()/.url(); older shapes return a plain URL string. Returns
 *  null for an unrecognized shape or an unreachable URL so the caller retries. */
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

export async function fetchCoverImage(
  input: string | PromptInput,
  industryArg = '',
): Promise<Cover | null> {
  // Back-compat: callers used to pass (title, industry). Normalize to PromptInput.
  const promptInput: PromptInput = typeof input === 'string'
    ? { title: input, industry: industryArg }
    : input;
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) return null;

  const replicate = new Replicate({ auth: apiKey });
  const prompt = await composePrompt(promptInput);

  // Minimal, schema-valid input for gpt-image-2. Do NOT add output_format —
  // it's rejected by the GPT image models and fails the whole prediction.
  const modelInput: Record<string, unknown> = {
    prompt,
    aspect_ratio: IMAGE_ASPECT,
    quality: IMAGE_QUALITY,
  };

  // Generate with retry. The model call is the flaky step — it can time out or
  // return a transient error under load, and a single miss used to leave the
  // article with no cover forever. Retry a few times before giving up.
  let imageBuffer: Uint8Array | null = null;
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const result = await Promise.race([
        replicate.run(IMAGE_MODEL, { input: modelInput }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('image generation timeout')), 120_000)
        ),
      ]);
      const first: any = Array.isArray(result) ? result[0] : result;
      if (!first) throw new Error('empty model output');
      imageBuffer = await toImageBytes(first);
      if (imageBuffer) break;
      throw new Error('unrecognized model output shape');
    } catch (err) {
      console.error(`[cover-image] ${IMAGE_MODEL} attempt ${attempt}/${ATTEMPTS} failed:`, err);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!imageBuffer) return null;

  // 3. Upload to Supabase Storage for permanent URL
  try {
    const sb = supabaseAdmin();

    // Auto-create the bucket if it doesn't exist yet (one-time setup)
    const { error: bucketErr } = await sb.storage.createBucket(BUCKET, { public: true });
    if (bucketErr && !bucketErr.message.toLowerCase().includes('already exists')) {
      console.error('[cover-image] Failed to create/verify bucket:', bucketErr.message);
      return null;
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(filename, imageBuffer, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadErr) {
      console.error('[cover-image] Supabase upload failed:', uploadErr.message);
      return null;
    }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(filename);
    if (!pub?.publicUrl) return null;

    const modelLabel = IMAGE_MODEL.split('/').pop() || IMAGE_MODEL;
    return {
      url: pub.publicUrl,
      credit: {
        name: `AI-generated via ${modelLabel}`,
        source: modelLabel,
        model: IMAGE_MODEL,
      },
    };
  } catch (err) {
    console.error('[cover-image] persist failed:', err);
    return null;
  }
}

/**
 * Injects a cover image into body_md right after the first H1 heading.
 * If no H1 is found, prepends the image at the top.
 */
export function injectCoverIntoBody(bodyMd: string, imageUrl: string, altText: string): string {
  const imageMarkdown = `\n\n![${altText}](${imageUrl})\n\n`;
  const lines = bodyMd.split('\n');
  const h1Index = lines.findIndex((l) => /^#\s/.test(l));
  if (h1Index === -1) return imageMarkdown.trimStart() + bodyMd;
  lines.splice(h1Index + 1, 0, imageMarkdown);
  return lines.join('\n');
}
