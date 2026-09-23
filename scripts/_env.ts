/**
 * Make the research scripts runnable with a bare `npx vite-node scripts/x.ts`.
 *
 * These scripts read production data, so they need Supabase credentials that
 * live in Vercel and are not on anyone's laptop by default. Without this, the
 * first thing every run does is fail on `supabaseUrl is required`, and the fix
 * is a shell incantation that has to be pasted correctly every time. The
 * incantation belongs in the repo, once.
 *
 * Resolution order, least to most surprising:
 *   1. Anything already in process.env wins — an explicit env var is a
 *      deliberate override and must never be clobbered by a file.
 *   2. .env.local, if present. Gitignored; this is where a key pasted by hand
 *      ends up.
 *   3. The project URL is a known public constant (it is in CLAUDE.md), so it
 *      is defaulted rather than demanded.
 *   4. The service-role key is fetched from the linked Supabase CLI. It is a
 *      secret, so it is read into memory and never printed or written to disk.
 *
 * Import for side effects, before any client is constructed:
 *   import './_env';
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_REF = 'lojgijnjagaozrrpjlbj';

/** Parse .env.local without adding a dotenv dependency. Existing vars win. */
function loadEnvFile(path = '.env.local'): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // `vercel env pull` writes the literal string [SENSITIVE] for values it is
    // not allowed to disclose (production secrets). That is a placeholder, not
    // a value — treating it as one yields an auth failure whose message points
    // at the wrong problem entirely.
    if (val === '[SENSITIVE]') continue;
    if (!(key in process.env)) process.env[key] = val;
  }
}

/** Service-role key from the linked CLI. Returns null rather than throwing —
 *  a script that only needs --dry should still run on a machine with no CLI. */
function serviceRoleFromCli(): string | null {
  try {
    const out = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 },
    );
    const keys = JSON.parse(out) as { name?: string; api_key?: string }[];
    return keys.find((k) => k.name === 'service_role')?.api_key ?? null;
  } catch {
    return null;
  }
}

loadEnvFile();

if (process.env.NEXT_PUBLIC_SUPABASE_URL === '[SENSITIVE]') delete process.env.NEXT_PUBLIC_SUPABASE_URL;
if (process.env.SUPABASE_SERVICE_ROLE_KEY === '[SENSITIVE]') delete process.env.SUPABASE_SERVICE_ROLE_KEY;

process.env.NEXT_PUBLIC_SUPABASE_URL ??= `https://${PROJECT_REF}.supabase.co`;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const key = serviceRoleFromCli();
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  else {
    console.error(
      'No SUPABASE_SERVICE_ROLE_KEY, and the Supabase CLI could not supply one.\n' +
      'Either `brew install supabase/tap/supabase && supabase login`, or put the\n' +
      'service-role key in .env.local (it is gitignored).',
    );
  }
}
