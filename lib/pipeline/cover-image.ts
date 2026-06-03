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

async function composePrompt(title: string, industry: string): Promise<string> {
  // The LLM picks 2-3 visual subjects from the title and weaves them into a
  // concrete Flux prompt. Falls back to a template if the call fails.
  try {
    const { text } = await llmCall({
      fast: true,
      maxTokens: 120,
      system: 'You write image-generation prompts. Output ONE sentence describing visual subjects. No quotes, no preamble, no markdown. Focus on concrete objects, materials, lighting. Avoid abstract or text.',
      user: `Article title: "${title}"\nBusiness: ${industry}\n\nWrite a single image prompt: what should the cover IMAGE depict? Keep it concrete and visual.`,
    });
    const subject = text.trim().replace(/^["']|["']$/g, '').slice(0, 200);
    return `${subject}, ${STYLE}`;
  } catch {
    return `abstract concept of ${title}, ${STYLE}`;
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
    .from('posts').select('title, meta_title, domains(site_profile)')
    .eq('id', postId).single();

  if (!post) { await appendLog(postId, 'cover_image', 'fail', 'post not found'); return; }
  const title = (post as any).meta_title || (post as any).title || '';
  const industry = (post as any).domains?.site_profile?.business?.industry ?? '';
  if (!title) { await appendLog(postId, 'cover_image', 'fail', 'no title'); return; }

  try {
    const cover = await fetchCoverImage(title, industry);
    if (!cover) {
      await appendLog(postId, 'cover_image', 'done', 'no image generated');
      return;
    }
    await sb.from('posts').update({
      cover_image_url: cover.url,
      cover_image_credit: cover.credit,
    }).eq('id', postId);
    await appendLog(postId, 'cover_image', 'done', cover.credit.name);
  } catch (err: any) {
    await appendLog(postId, 'cover_image', 'fail', String(err?.message ?? err));
  }
}

export async function fetchCoverImage(title: string, industry = ''): Promise<Cover | null> {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) return null;

  let imageBuffer: Uint8Array;
  try {
    const replicate = new Replicate({ auth: apiKey });
    const prompt = await composePrompt(title, industry);

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
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(filename, imageBuffer, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadErr) {
      console.error('[cover-image] Supabase upload failed (is the bucket created and public?):', uploadErr.message);
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
