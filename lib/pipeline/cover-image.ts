/**
 * AI-generated cover image via Replicate Flux Schnell.
 *
 * Pipeline:
 *  1. LLM crafts a Flux prompt from the article's title + business industry
 *  2. Flux Schnell renders the image (~3-5s, ~$0.003 per image)
 *  3. Image is downloaded and uploaded to Supabase Storage (Replicate URLs
 *     expire after ~60 minutes, so we must persist them)
 *  4. Return the public Supabase URL + AI credit
 *
 * Required setup (one-time):
 *  - Supabase Dashboard → Storage → Create bucket "post-covers" (Public: ON)
 *
 * Required env:
 *  - REPLICATE_API_TOKEN  (already set for the LLM client)
 *
 * Returns null on any failure — the article still publishes without a cover,
 * caller logs the reason.
 */
import Replicate from 'replicate';
import { llmCall } from '../llm';
import { supabaseAdmin } from '../supabase/admin';

const FLUX_MODEL = 'black-forest-labs/flux-schnell' as const;
const BUCKET = process.env.COVER_BUCKET ?? 'post-covers';

export type Cover = {
  url: string;
  credit: { name: string; source: 'flux-schnell'; model: string };
};

const STYLE = `editorial illustration style — clean, modern, minimalist composition
with soft gradient background, restrained palette of 2-3 muted colors,
geometric shapes and subtle textures, magazine-cover quality, no text, no people,
landscape 16:9 framing`;

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
      fast: true,
      maxTokens: 180,
      system: `You write image-generation prompts for editorial blog covers.
The cover MUST visually echo the article's specific argument AND fit the
business's product domain — not generic stock imagery.

RULES
- Output ONE sentence. No quotes, no preamble, no markdown, no lists.
- Pick a concrete visual metaphor that maps to the article's central idea
  (e.g. "before/after split frame", "stacked layers being lifted", "tools
  laid out on a workbench"). Not abstract swirls.
- Anchor the imagery in objects the business's audience would recognize from
  their own work — UI surfaces, icons, panels, blueprints, etc. — based on
  the business description and products.
- Concrete subjects, materials, lighting. No people, no faces, no readable
  text or logos on the image.
- 25–45 words.`,
      user: `BUSINESS: ${businessName || '(unknown)'} — ${businessDescription || industry || '(unknown)'}
PRODUCTS / SERVICES: ${products.slice(0, 4).join(', ') || '(unknown)'}

ARTICLE TITLE: "${title}"
ARTICLE ESSENCE: ${essence || '(none — infer from title)'}

Write the image prompt now.`,
    });
    const subject = text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 320);
    return `${subject}, ${STYLE}`;
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
export async function runCoverForPost(postId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { appendLog } = await import('./log');

  await appendLog(postId, 'cover_image', 'start');

  const { data: post } = await sb
    .from('posts').select('title, meta_title, body_md, domains(site_profile)')
    .eq('id', postId).single();

  if (!post) { await appendLog(postId, 'cover_image', 'fail', 'post not found'); return; }
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

  let imageBuffer: Uint8Array;
  try {
    const replicate = new Replicate({ auth: apiKey });
    const prompt = await composePrompt(promptInput);

    // 1. Generate via Flux Schnell with hard 90s timeout
    const result = await Promise.race([
      replicate.run(FLUX_MODEL, {
        input: {
          prompt,
          aspect_ratio: '16:9',
          output_format: 'webp',
          output_quality: 90,
          num_outputs: 1,
          go_fast: true,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Flux generation timeout')), 90_000)
      ),
    ]);

    // Replicate v1 returns array of file-like objects with .url() and .blob()/.read()
    const first: any = Array.isArray(result) ? result[0] : result;
    if (!first) return null;

    // 2. Get the actual bytes (Replicate URLs expire in ~60min so we must persist)
    if (typeof first.blob === 'function') {
      const blob = await first.blob();
      imageBuffer = new Uint8Array(await blob.arrayBuffer());
    } else if (typeof first.url === 'function' || typeof first === 'string') {
      const imgUrl = typeof first === 'string' ? first : first.url();
      const resolvedUrl = typeof imgUrl === 'string' ? imgUrl : (imgUrl?.toString?.() ?? '');
      const res = await fetch(resolvedUrl);
      if (!res.ok) return null;
      imageBuffer = new Uint8Array(await res.arrayBuffer());
    } else {
      return null;
    }
  } catch (err) {
    console.error('[cover-image] Flux failed:', err);
    return null;
  }

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

    return {
      url: pub.publicUrl,
      credit: {
        name: 'AI-generated via Flux Schnell',
        source: 'flux-schnell',
        model: FLUX_MODEL,
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
