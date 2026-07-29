/**
 * Put the author's OWN image in a draft.
 *
 * The sibling route (`../illustration`) generates a picture; this one accepts
 * the picture they already have. Both are domain-scoped rather than
 * post-scoped for the same reason: the Write page's canvas has no post row
 * until it's saved, and nobody should have to save a blank draft before they
 * can drop in a screenshot.
 *
 * Multipart rather than JSON/base64 — base64 inflates the payload by a third,
 * and the request body ceiling is the binding constraint here (see
 * MAX_UPLOAD_BYTES).
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { MAX_UPLOAD_BYTES, sanitizeForStorage, validateUpload } from '@/lib/images/upload';
import { persistUploadedImage } from '@/lib/images/upload-store';
import { sanitizeAlt } from '@/lib/images/prompt';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { captureServer } from '@/lib/analytics/capture-server';

export const maxDuration = 60;

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`upload:${user.id}`, LIMITS.upload);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // A body over the platform ceiling dies here rather than at our size check,
    // so this has to say the useful thing too.
    return NextResponse.json(
      { error: `Could not read that upload — images must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }

  const domainId = form.get('domain_id');
  const file = form.get('file');
  if (typeof domainId !== 'string' || !domainId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image was attached.' }, { status: 400 });
  }

  // RLS-scoped: proves the caller owns the domain before anything is stored.
  const { data: domain } = await sb
    .from('domains').select('id').eq('id', domainId).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload(bytes);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  const clean = sanitizeForStorage(bytes, check.type);
  const url = await persistUploadedImage(clean, check.type);
  if (!url) {
    return NextResponse.json(
      { error: 'Could not save that image. Try again in a moment.' },
      { status: 502 },
    );
  }

  // The filename is the author's only description of the picture, so it's the
  // best alt text available without asking — and it's editable in the canvas.
  // sanitizeAlt strips the markdown-breaking characters a filename can carry.
  const alt = sanitizeAlt(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));

  await captureServer(user.id, 'image_uploaded', {
    domain_id: domainId,
    format: check.type,
    bytes: clean.length,
  });
  return NextResponse.json({ url, alt });
}
