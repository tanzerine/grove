/**
 * SERVER-ONLY. The storage half of `upload.ts`.
 *
 * Split out so the validation rules next door stay importable from the editor
 * (a client component) — see the note at the top of `upload.ts`.
 *
 * Same bucket as covers and inline illustrations. Only the key prefix differs,
 * so where a file came from is readable straight off a storage listing.
 */
import { supabaseAdmin } from '../supabase/admin';
import { extensionFor, mimeFor, type UploadImageType } from './upload';

const BUCKET = process.env.COVER_BUCKET ?? 'post-covers';

/**
 * Store validated bytes and hand back the public URL.
 *
 * The caller's filename never reaches the storage key: it's caller-controlled
 * text that would otherwise decide a path. We name the object ourselves, the
 * same way covers and illustrations are named.
 */
export async function persistUploadedImage(
  bytes: Uint8Array,
  type: UploadImageType,
): Promise<string | null> {
  try {
    const sb = supabaseAdmin();
    const { error: bucketErr } = await sb.storage.createBucket(BUCKET, { public: true });
    if (bucketErr && !bucketErr.message.toLowerCase().includes('already exists')) {
      console.error('[upload] bucket unavailable:', bucketErr.message);
      return null;
    }

    const filename = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(type)}`;
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(filename, bytes, {
      contentType: mimeFor(type),
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadErr) {
      console.error('[upload] storage upload failed:', uploadErr.message);
      return null;
    }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(filename);
    return pub?.publicUrl ?? null;
  } catch (err) {
    console.error('[upload] persist failed:', err);
    return null;
  }
}
