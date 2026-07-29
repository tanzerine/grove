/**
 * Author-supplied images — the counterpart to `illustration.ts`.
 *
 * Everything else in this folder *generates* a picture; this one takes the one
 * the author already has (a screenshot, a product photo, their own chart) and
 * puts it in the same place, so the editor can insert it exactly like a
 * generated image and `body_md` keeps a single shape: `![alt](public url)`.
 *
 * DEPENDENCY-FREE ON PURPOSE. The editor is a client component and needs the
 * same size ceiling and format list to reject a file before spending a round
 * trip on it. Anything importing `supabaseAdmin` can't be pulled into the
 * browser, so the storage write lives next door in `upload-store.ts` and this
 * file stays importable from both sides. One definition, two callers, no drift.
 */

/**
 * 4 MB.
 *
 * Not a product opinion — Vercel caps a Serverless Function's *request body* at
 * 4.5 MB, and the multipart envelope costs a little on top of the file itself.
 * A larger ceiling here would just move the failure from our error message
 * (which tells the author to shrink the image) to a bare platform 413 (which
 * tells them nothing). Raise this only alongside a direct-to-storage upload
 * that doesn't route the bytes through a function.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * What we accept — and, by omission, what we don't.
 *
 * SVG is deliberately absent. An `.svg` is a document, not a bitmap: it can
 * carry `<script>`, `<foreignObject>` and external references, and these files
 * are served from a public Supabase Storage origin and rendered inside the
 * customer's own blog. Accepting one would be a stored-XSS primitive. The
 * sniffer below can only ever return a raster format, so SVG fails validation
 * on content rather than on file extension — which is the check that actually
 * holds when someone renames `payload.svg` to `photo.png`.
 */
export type UploadImageType = 'png' | 'jpeg' | 'webp' | 'gif';

const MIME: Record<UploadImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const EXT: Record<UploadImageType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
};

export function mimeFor(type: UploadImageType): string { return MIME[type]; }
export function extensionFor(type: UploadImageType): string { return EXT[type]; }

function matches(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/**
 * The format a file ACTUALLY is, read from its magic bytes.
 *
 * The browser-reported `file.type` and the filename extension are both just
 * claims made by the caller; neither survives a rename, and the whole point of
 * the allow-list above is that it can't be talked out of. Content is the only
 * input here.
 */
export function sniffImageType(bytes: Uint8Array): UploadImageType | null {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (matches(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (matches(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  // RIFF....WEBP — the size field sits between the two signatures.
  if (matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export type UploadCheck =
  | { ok: true; type: UploadImageType }
  | { ok: false; reason: string };

/** Every reason a file is turned away, phrased for the author who picked it. */
export function validateUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, reason: 'That file is empty.' };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Try exporting it smaller.`,
    };
  }
  const type = sniffImageType(bytes);
  if (!type) {
    return { ok: false, reason: 'That doesn’t look like a PNG, JPEG, WebP or GIF. SVGs aren’t supported.' };
  }
  return { ok: true, type };
}

/**
 * Drop JPEG metadata segments — APP1..APP15 (EXIF, XMP, IPTC) and COM.
 *
 * A photo straight off a phone carries EXIF, and EXIF routinely carries GPS
 * coordinates. Publishing it untouched would put the author's home address on
 * their own blog in a field nobody thinks to look at. Stripping is cheap and
 * the alternative is a privacy leak we'd have shipped on their behalf.
 *
 * Deliberately conservative: anything unexpected in the segment structure
 * returns the original bytes rather than a half-rewritten file. A picture with
 * intact EXIF beats a corrupted one.
 *
 * APP0 (JFIF) is kept — it's structural and carries no personal data. PNG/WebP
 * text chunks are left alone too; camera GPS is overwhelmingly a JPEG concern,
 * and rewriting those containers has a worse corruption-to-benefit ratio.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const keep: Array<[number, number]> = [[0, 2]];   // SOI
  let i = 2;
  let reachedScan = false;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return bytes;            // desynced — leave it alone
    const marker = bytes[i + 1];

    // Standalone markers: no length field follows.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }
    // Start of scan: entropy-coded data runs to EOI, so copy the tail verbatim.
    if (marker === 0xda) {
      keep.push([i, bytes.length]);
      reachedScan = true;
      break;
    }
    if (i + 3 >= bytes.length) return bytes;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > bytes.length) return bytes;

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) keep.push([i, end]);
    i = end;
  }

  if (!reachedScan) return bytes;

  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  if (total === bytes.length) return bytes;         // nothing to strip

  const out = new Uint8Array(total);
  let o = 0;
  for (const [s, e] of keep) { out.set(bytes.subarray(s, e), o); o += e - s; }
  return out;
}

/** Metadata-stripped bytes, ready to store. Non-JPEG passes straight through. */
export function sanitizeForStorage(bytes: Uint8Array, type: UploadImageType): Uint8Array {
  return type === 'jpeg' ? stripJpegMetadata(bytes) : bytes;
}
