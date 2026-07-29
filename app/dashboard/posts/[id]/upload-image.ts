/**
 * Client half of the image upload — one function, three entry points.
 *
 * The author can add their own picture by picking a file, dropping it on the
 * canvas, or pasting it from the clipboard. All three land here so the size
 * check, the error wording and the returned shape can't diverge between them.
 */
import { MAX_UPLOAD_BYTES } from '@/lib/images/upload';

export type UploadedImage = { url: string; alt: string };

export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/**
 * Why this file can't be uploaded, or null if it can.
 *
 * A courtesy check only — the server re-validates from the file's actual magic
 * bytes, because `file.type` is a claim the browser passes along unverified.
 * Catching the obvious cases here saves the author a round trip to be told the
 * same thing.
 */
export function localImageError(file: File): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_UPLOAD_MB} MB. Try exporting it smaller.`;
  }
  if (file.type === 'image/svg+xml') return 'SVGs aren’t supported — export it as a PNG.';
  if (file.type && !file.type.startsWith('image/')) return 'That isn’t an image file.';
  return null;
}

/** Is this something we should even try to upload? Used to filter drops/pastes. */
export function looksLikeImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/** Upload and return the stored image. Throws with a message fit to display. */
export async function uploadImage(file: File, domainId: string): Promise<UploadedImage> {
  const local = localImageError(file);
  if (local) throw new Error(local);

  const form = new FormData();
  form.append('domain_id', domainId);
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch('/api/images/upload', { method: 'POST', body: form });
  } catch {
    throw new Error('Upload failed — check your connection and try again.');
  }

  const j = await res.json().catch(() => ({} as any));
  if (!res.ok || !j.url) {
    throw new Error(j.error ?? 'Could not save that image. Try again.');
  }
  return { url: j.url, alt: j.alt ?? '' };
}
