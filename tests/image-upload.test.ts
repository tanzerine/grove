import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  extensionFor,
  mimeFor,
  sanitizeForStorage,
  sniffImageType,
  stripJpegMetadata,
  validateUpload,
} from '../lib/images/upload';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function bytes(...parts: Array<number[] | number>): Uint8Array {
  const flat: number[] = [];
  for (const p of parts) Array.isArray(p) ? flat.push(...p) : flat.push(p);
  return new Uint8Array(flat);
}

/** RIFF + 4-byte size + WEBP — the signature is split across two offsets. */
function webp(): Uint8Array {
  return bytes([0x52, 0x49, 0x46, 0x46], [0, 0, 0, 0], [0x57, 0x45, 0x42, 0x50]);
}

describe('sniffImageType', () => {
  it('identifies the four supported formats from their magic bytes', () => {
    expect(sniffImageType(bytes(PNG))).toBe('png');
    expect(sniffImageType(bytes(JPEG))).toBe('jpeg');
    expect(sniffImageType(bytes(GIF))).toBe('gif');
    expect(sniffImageType(webp())).toBe('webp');
  });

  it('rejects SVG however it is dressed up', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
    expect(validateUpload(svg).ok).toBe(false);
  });

  it('ignores a claimed type and reads the content — a renamed file is still rejected', () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect(sniffImageType(html)).toBeNull();
  });

  it('does not mistake a bare RIFF container (e.g. a .wav) for WebP', () => {
    const wav = bytes([0x52, 0x49, 0x46, 0x46], [0, 0, 0, 0], [0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('handles a truncated file without throwing', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts a well-formed image', () => {
    expect(validateUpload(bytes(PNG))).toEqual({ ok: true, type: 'png' });
  });

  it('rejects an empty file', () => {
    const res = validateUpload(new Uint8Array());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/empty/i);
  });

  it('rejects anything over the size ceiling, and says the actual size', () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG);
    const res = validateUpload(big);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/MB/);
  });

  it('accepts a file exactly at the ceiling', () => {
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(PNG);
    expect(validateUpload(exact).ok).toBe(true);
  });
});

describe('mimeFor / extensionFor', () => {
  it('maps every type to a content type and a file extension', () => {
    expect(mimeFor('jpeg')).toBe('image/jpeg');
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(mimeFor('webp')).toBe('image/webp');
    expect(extensionFor('png')).toBe('png');
  });
});

describe('stripJpegMetadata', () => {
  // SOI, APP1 (EXIF with a fake GPS payload), SOS, scan data, EOI.
  function jpegWithExif(): Uint8Array {
    const exifPayload = [...new TextEncoder().encode('Exif\0\0GPS 51.5074,-0.1278')];
    const len = exifPayload.length + 2;
    return bytes(
      [0xff, 0xd8],                                    // SOI
      [0xff, 0xe1], [(len >> 8) & 0xff, len & 0xff], exifPayload,  // APP1
      [0xff, 0xda], [0x00, 0x02],                      // SOS
      [0x11, 0x22, 0x33],                              // entropy-coded data
      [0xff, 0xd9],                                    // EOI
    );
  }

  it('removes the EXIF segment and the GPS coordinates inside it', () => {
    const stripped = stripJpegMetadata(jpegWithExif());
    const asText = new TextDecoder().decode(stripped);
    expect(asText).not.toContain('51.5074');
    expect(asText).not.toContain('Exif');
    expect(stripped.length).toBeLessThan(jpegWithExif().length);
  });

  it('keeps the image structure intact — SOI, scan data and EOI survive', () => {
    const stripped = stripJpegMetadata(jpegWithExif());
    expect([stripped[0], stripped[1]]).toEqual([0xff, 0xd8]);
    expect([stripped[stripped.length - 2], stripped[stripped.length - 1]]).toEqual([0xff, 0xd9]);
    expect(Array.from(stripped)).toEqual(
      expect.arrayContaining([0x11, 0x22, 0x33]),
    );
  });

  it('keeps APP0/JFIF, which carries no personal data', () => {
    const withJfif = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0], [0x00, 0x04], [0xaa, 0xbb],   // APP0
      [0xff, 0xda], [0x00, 0x02], [0x77],
      [0xff, 0xd9],
    );
    const stripped = stripJpegMetadata(withJfif);
    expect(Array.from(stripped)).toEqual(Array.from(withJfif));
  });

  it('returns the original bytes untouched when the structure is malformed', () => {
    // A length field that runs past the end of the buffer.
    const broken = bytes([0xff, 0xd8], [0xff, 0xe1], [0xff, 0xff], [0x01, 0x02]);
    expect(Array.from(stripJpegMetadata(broken))).toEqual(Array.from(broken));
  });

  it('leaves a non-JPEG alone', () => {
    const png = bytes(PNG, [1, 2, 3]);
    expect(Array.from(stripJpegMetadata(png))).toEqual(Array.from(png));
    expect(Array.from(sanitizeForStorage(png, 'png'))).toEqual(Array.from(png));
  });
});
