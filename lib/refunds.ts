/**
 * Churn / refund-funnel config. Client-safe (no secrets) — the survey reason
 * codes and their human labels live here so the funnel UI, the owner email,
 * and the admin view all speak the same vocabulary.
 */

export type RefundReason = {
  code: string;
  label: string;
};

// Ordered for display. `code` is what's stored; `label` is what's shown.
export const REFUND_REASONS: RefundReason[] = [
  { code: 'too_expensive', label: 'Too expensive for the value' },
  { code: 'no_results', label: "Didn't see SEO results yet" },
  { code: 'quality', label: "Content quality wasn't good enough" },
  { code: 'missing_features', label: 'Missing features I need' },
  { code: 'too_complex', label: 'Too complicated to set up / use' },
  { code: 'switched', label: 'Found a better alternative' },
  { code: 'just_testing', label: 'Was just testing / not ready' },
  { code: 'other', label: 'Something else' },
];

export const REFUND_REASON_CODES = REFUND_REASONS.map((r) => r.code);

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return REFUND_REASONS.find((r) => r.code === code)?.label ?? code;
}

export type RefundStatus = 'pending' | 'refunded' | 'no_charge' | 'failed' | 'dismissed';
