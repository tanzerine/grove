/**
 * Minimal Resend client — sends transactional email via the REST API so we
 * don't pull in an SDK for one call.
 *
 * Degrades gracefully like the social adapters: with no RESEND_API_KEY the
 * send is a console.warn no-op (returns { skipped: true }) so local dev and
 * preview deploys never throw or leak a half-configured integration.
 */
export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { id: string }
  | { skipped: true; reason: string }
  | { error: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** From address — defaults to a Grove-branded sender; override per env. */
function fromAddress(): string {
  return process.env.RESEND_FROM ?? 'Grove <agent@trygroveai.com>';
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY unset — skipping send to', input.to);
    return { skipped: true, reason: 'no_api_key' };
  }

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { error: `resend returned ${r.status} ${body}`.slice(0, 300) };
    }
    const json = (await r.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? 'sent' };
  } catch (e: any) {
    return { error: String(e?.message ?? e).slice(0, 300) };
  }
}
