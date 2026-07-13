/**
 * Vercel Domains API client — attaches a customer's CNAME'd blog hostname
 * (domains.custom_blog_hostname) to the grove Vercel project automatically, so
 * enrolling needs zero manual dashboard work. Without this, a hostname set in
 * the DB is served by our middleware but Vercel won't route to it or issue TLS
 * until someone adds it under Project → Domains by hand.
 *
 * Env-gated so everything degrades gracefully (like lib/email/resend.ts): with
 * no VERCEL_API_TOKEN / VERCEL_PROJECT_ID the calls become {state:'skipped'}
 * no-ops and the old manual step remains the fallback — nothing 500s.
 *
 *   VERCEL_API_TOKEN  — token with domain scope (Account → Settings → Tokens)
 *   VERCEL_PROJECT_ID — the grove project id (prj_…) or its name
 *   VERCEL_TEAM_ID    — required only when the project lives under a team
 *
 * The network calls never throw: a Vercel hiccup must not fail the customer's
 * settings save (the DB row is already committed), so every path resolves to a
 * typed result the caller can surface.
 */

const API_BASE = 'https://api.vercel.com';

export type VercelChallenge = { type: string; domain: string; value: string; reason?: string };

export type DomainAttachResult =
  | { ok: true; state: 'attached' | 'already_attached'; verified: boolean; verification: VercelChallenge[] }
  | { ok: false; state: 'skipped'; reason: 'not_configured' }
  | { ok: false; state: 'error'; message: string };

type VercelEnv = { token?: string; projectId?: string; teamId?: string };

function readEnv(): VercelEnv {
  return {
    token: process.env.VERCEL_API_TOKEN || undefined,
    projectId: process.env.VERCEL_PROJECT_ID || undefined,
    teamId: process.env.VERCEL_TEAM_ID || undefined,
  };
}

/** True only when both a token and a project are configured. */
export function isVercelDomainsConfigured(env: VercelEnv = readEnv()): boolean {
  return !!(env.token && env.projectId);
}

/** `?teamId=…` when a team is configured, else ''. Kept separate so the two URL
 *  builders can't disagree on team scoping. */
export function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

/** POST/GET collection endpoint for a project's domains. */
export function projectDomainsUrl(projectId: string, teamId?: string): string {
  return `${API_BASE}/v10/projects/${encodeURIComponent(projectId)}/domains${teamQuery(teamId)}`;
}

/** GET/DELETE endpoint for one domain on a project. */
export function projectDomainUrl(projectId: string, name: string, teamId?: string): string {
  return `${API_BASE}/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(name)}${teamQuery(teamId)}`;
}

/** Vercel returns verification challenges in a loose shape; keep only the
 *  fields the dashboard needs and drop anything malformed. */
export function normalizeChallenges(raw: unknown): VercelChallenge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      type: String(c.type ?? ''),
      domain: String(c.domain ?? ''),
      value: String(c.value ?? ''),
      reason: c.reason ? String(c.reason) : undefined,
    }))
    .filter((c) => c.type && c.value);
}

/** Interpret a 2xx add/get body into a success result. Pure — the async
 *  wrappers own the network and error mapping. */
export function classifyDomainBody(json: unknown, state: 'attached' | 'already_attached'): DomainAttachResult {
  const body = (json ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    state,
    verified: body.verified === true,
    verification: normalizeChallenges(body.verification),
  };
}

async function vercelFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** Read one domain's state on the project. Used to resolve a 409 (is the
 *  conflict our own project, or another account?) and by the reconcile cron. */
export async function getProjectDomain(name: string, env: VercelEnv = readEnv()): Promise<DomainAttachResult> {
  if (!isVercelDomainsConfigured(env)) return { ok: false, state: 'skipped', reason: 'not_configured' };
  try {
    const res = await vercelFetch(projectDomainUrl(env.projectId!, name, env.teamId), env.token!);
    const json = await res.json().catch(() => ({}));
    if (res.ok) return classifyDomainBody(json, 'already_attached');
    if (res.status === 404) return { ok: false, state: 'error', message: 'not attached to this project' };
    return { ok: false, state: 'error', message: errMessage(json, res.status) };
  } catch (e) {
    return { ok: false, state: 'error', message: String(e) };
  }
}

/**
 * Idempotently attach `name` to the grove project. Safe to call repeatedly —
 * a domain already on the project resolves to {state:'already_attached'}, so
 * the reconcile cron can run it every night without churn.
 */
export async function attachProjectDomain(name: string, env: VercelEnv = readEnv()): Promise<DomainAttachResult> {
  if (!isVercelDomainsConfigured(env)) return { ok: false, state: 'skipped', reason: 'not_configured' };
  try {
    const res = await vercelFetch(projectDomainsUrl(env.projectId!, env.teamId), env.token!, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return classifyDomainBody(json, 'attached');
    // 409: the domain already exists somewhere. If it's on OUR project this is a
    // successful re-run; if it belongs to another account, surface the error.
    if (res.status === 409) {
      const existing = await getProjectDomain(name, env);
      if (existing.ok) return existing;
      return { ok: false, state: 'error', message: errMessage(json, res.status) };
    }
    return { ok: false, state: 'error', message: errMessage(json, res.status) };
  } catch (e) {
    return { ok: false, state: 'error', message: String(e) };
  }
}

/** Best-effort removal (old hostname when a customer changes or clears it).
 *  A missing domain is treated as success — the desired end state is reached. */
export async function detachProjectDomain(name: string, env: VercelEnv = readEnv()): Promise<{ ok: boolean; message?: string }> {
  if (!isVercelDomainsConfigured(env)) return { ok: true };
  try {
    const res = await vercelFetch(projectDomainUrl(env.projectId!, name, env.teamId), env.token!, { method: 'DELETE' });
    if (res.ok || res.status === 404) return { ok: true };
    const json = await res.json().catch(() => ({}));
    return { ok: false, message: errMessage(json, res.status) };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export function errMessage(json: unknown, status: number): string {
  const err = (json as { error?: { message?: string } } | null)?.error;
  return err?.message || `vercel responded ${status}`;
}

/** The single CNAME record a customer must add for us to route + TLS the host.
 *  Pulled from the returned challenges when present, else the standard default. */
export function cnameHint(result: DomainAttachResult): { host: string; value: string } {
  const fallback = { host: 'blog', value: 'cname.vercel-dns.com' };
  if (!result.ok) return fallback;
  const cname = result.verification.find((c) => c.type.toLowerCase() === 'cname');
  return cname ? { host: cname.domain || fallback.host, value: cname.value } : fallback;
}
