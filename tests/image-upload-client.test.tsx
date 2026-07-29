/**
 * The client half of image upload: the guard that runs before a byte leaves the
 * browser, and the tool that has to offer the choice in the first place.
 *
 * The server re-validates everything here from magic bytes (see
 * image-upload.test.ts) — this covers the layer the author actually touches,
 * where a wrong answer means a confusing round trip or, for SVG, offering a
 * file type we refuse to store.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  localImageError,
  looksLikeImage,
  MAX_UPLOAD_MB,
  UPLOAD_ACCEPT,
} from '@/app/dashboard/posts/[id]/upload-image';
import { MAX_UPLOAD_BYTES, mimeFor, type UploadImageType } from '@/lib/images/upload';

/** What the server will actually store — the picker must not exceed this. */
const SERVER_MIMES = (['png', 'jpeg', 'webp', 'gif'] as UploadImageType[]).map(mimeFor);

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import ImageStudio from '@/app/dashboard/posts/[id]/ImageStudio';

/** A File of a given size/type without allocating the bytes twice over. */
function fileOf(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(Math.min(size, 1))], name, { type });
  // File.size is read-only; override it so we can test the ceiling cheaply.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('localImageError', () => {
  it('passes a normal image through', () => {
    expect(localImageError(fileOf('shot.png', 'image/png', 1024))).toBeNull();
  });

  it('turns away an SVG by name, so we never offer to store one', () => {
    const err = localImageError(fileOf('logo.svg', 'image/svg+xml', 500));
    expect(err).toMatch(/SVG/i);
  });

  it('turns away a non-image', () => {
    expect(localImageError(fileOf('notes.pdf', 'application/pdf', 500))).toMatch(/isn’t an image/i);
  });

  it('turns away an empty file', () => {
    expect(localImageError(fileOf('empty.png', 'image/png', 0))).toMatch(/empty/i);
  });

  it('turns away anything over the ceiling and names the real size', () => {
    const err = localImageError(fileOf('huge.png', 'image/png', MAX_UPLOAD_BYTES + 1));
    expect(err).toContain(`${MAX_UPLOAD_MB} MB`);
  });

  it('accepts a file exactly at the ceiling', () => {
    expect(localImageError(fileOf('exact.png', 'image/png', MAX_UPLOAD_BYTES))).toBeNull();
  });

  it('allows a file the browser gave no type for — the server decides on content', () => {
    expect(localImageError(fileOf('screenshot', '', 2048))).toBeNull();
  });
});

describe('looksLikeImage', () => {
  it('accepts raster images and rejects SVG and non-images', () => {
    expect(looksLikeImage(fileOf('a.png', 'image/png', 10))).toBe(true);
    expect(looksLikeImage(fileOf('a.jpg', 'image/jpeg', 10))).toBe(true);
    expect(looksLikeImage(fileOf('a.svg', 'image/svg+xml', 10))).toBe(false);
    expect(looksLikeImage(fileOf('a.txt', 'text/plain', 10))).toBe(false);
  });
});

describe('ImageStudio', () => {
  const props = {
    domainId: 'd1',
    contextOf: () => ({ title: 'T' }),
    onInsert: () => {},
    onClose: () => {},
  };

  it('offers uploading as a first-class choice, not just generation', () => {
    const html = renderToStaticMarkup(<ImageStudio {...props} />);
    expect(html).toContain('Generate');
    expect(html).toContain('Upload');
  });

  it('never offers the author a file type the server would refuse', () => {
    // Asserted on the constant, not on rendered markup: the file input only
    // exists once the upload tab is selected, and a markup check would quietly
    // pass against a default render that has no input in it at all.
    expect(UPLOAD_ACCEPT).not.toContain('svg');
    expect(UPLOAD_ACCEPT).not.toContain('image/*');
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(UPLOAD_ACCEPT).toContain(t);
    }
    // Every type offered must be one validateUpload() actually accepts.
    for (const t of UPLOAD_ACCEPT.split(',')) {
      expect(SERVER_MIMES).toContain(t);
    }
  });

  it('mounts without crashing when there is no domain yet', () => {
    expect(() => renderToStaticMarkup(<ImageStudio {...props} domainId={undefined} />)).not.toThrow();
  });
});
