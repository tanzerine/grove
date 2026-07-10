/**
 * Repo knowledge — reads the customer's GitHub repository and extracts what
 * the product ACTUALLY does: real features, real step-by-step usage, real
 * terminology. The site crawl (site-profile.ts) only sees marketing copy;
 * this sees the docs the team wrote for themselves.
 *
 * The result unlocks two article formats the writer can't do honestly from
 * marketing copy alone: `tutorial` (step-by-step "how to use X") and
 * `deep-dive` (one feature examined properly).
 *
 * Fetches go to api.github.com only (fixed host, path segments validated —
 * no SSRF surface). Public repos work unauthenticated; private repos need a
 * fine-grained PAT with read-only Contents scope.
 */
import { llmCall, extractJson } from '../llm';

export type RepoFeature = {
  name: string;                 // the feature as the docs name it
  what_it_does: string;         // one-two sentences, concrete
  how_to_use: string[];         // ordered steps a reader could follow
  details: string;              // flags, options, limits worth citing in an article
};

export type RepoKnowledge = {
  repo: string;                 // "owner/repo"
  synced_at: string;            // ISO timestamp of the sync
  product_summary: string;      // what the product is, from the code's own docs
  features: RepoFeature[];
  concepts: string[];           // domain terms the docs use (the product's vocabulary)
  setup: string[];              // getting-started steps, if documented
  files_read: string[];         // repo paths the extraction was grounded in
};

/**
 * Normalize user input to "owner/repo". Accepts bare "owner/repo" or any
 * github.com URL form (https, trailing .git, deep links into the repo).
 * Returns null when the input can't be a GitHub repo reference.
 */
export function parseRepoRef(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const SEG = /^[A-Za-z0-9_.-]+$/;
  let owner: string | undefined;
  let repo: string | undefined;

  const url = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
  if (url) {
    [, owner, repo] = url;
  } else if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    [owner, repo] = raw.split('/');
  }
  if (!owner || !repo) return null;
  repo = repo.replace(/\.git$/i, '');
  if (!SEG.test(owner) || !SEG.test(repo) || owner.startsWith('.') || repo === '.' || repo === '..') return null;
  return `${owner}/${repo}`;
}

const MAX_DOC_FILES = 12;
const MAX_FILE_CHARS = 20_000;
const MAX_CORPUS_CHARS = 60_000;

/** Root-level docs that are usually meta, not product knowledge. */
const SKIP_ROOT = /^(code_of_conduct|contributing|license|security|support|governance|codeowners|pull_request_template|issue_template)/i;

/**
 * Pick the doc files worth reading from a repo's file listing, best-first.
 * Pure so the selection heuristics are unit-testable. Priority:
 *   1. root README
 *   2. root ARCHITECTURE / FEATURES / USAGE / GETTING-STARTED / CHANGELOG
 *   3. docs|documentation|doc|guides/**.md — shallower paths first
 *   4. any other root-level .md
 */
export function pickDocPaths(paths: string[]): string[] {
  const md = paths.filter((p) =>
    /\.(md|mdx|txt)$/i.test(p) &&
    !/(^|\/)(node_modules|vendor|test|tests|__tests__|fixtures|\.github)\//i.test(p));

  const score = (p: string): number => {
    const base = p.split('/').pop() ?? p;
    const depth = p.split('/').length;
    if (depth === 1) {
      if (/^readme\./i.test(base)) return 0;
      if (SKIP_ROOT.test(base)) return 99;
      if (/^(architecture|features|usage|getting[-_]?started|quickstart|changelog)/i.test(base)) return 1;
      return 3;
    }
    if (/^(docs|documentation|doc|guides)\//i.test(p)) return 2 + depth * 0.1;
    if (/(^|\/)readme\.md$/i.test(p)) return 4 + depth * 0.1;
    return 98; // deep non-docs markdown — almost never product knowledge
  };

  return md
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s < 90)
    .sort((a, b) => a.s - b.s || a.p.length - b.p.length)
    .slice(0, MAX_DOC_FILES)
    .map((x) => x.p);
}

/**
 * Serialize repo knowledge into the writer's CUSTOMER KNOWLEDGE BASE block.
 * Pure. Compact on purpose — this rides along on every writer call.
 */
export function repoKbPrompt(kb: RepoKnowledge | null | undefined): string {
  if (!kb?.product_summary && !kb?.features?.length) return '';
  const lines: string[] = [
    `Source: the team's own repository (${kb.repo}). These are REAL features and REAL steps — prefer them over anything inferred.`,
    '',
    `PRODUCT: ${kb.product_summary}`,
  ];
  if (kb.concepts?.length) lines.push(`TERMINOLOGY the product uses: ${kb.concepts.join(', ')}`);
  if (kb.setup?.length) lines.push(`SETUP / GETTING STARTED:\n${kb.setup.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
  for (const f of kb.features ?? []) {
    lines.push('', `FEATURE: ${f.name}`, `  What it does: ${f.what_it_does}`);
    if (f.how_to_use?.length) lines.push(`  How to use it:\n${f.how_to_use.map((s, i) => `    ${i + 1}. ${s}`).join('\n')}`);
    if (f.details) lines.push(`  Details worth citing: ${f.details}`);
  }
  return lines.join('\n').slice(0, 12_000);
}

/* ─────────────────────────── GitHub fetching ─────────────────────────── */

async function gh(path: string, token?: string, raw = false): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    return await fetch(`https://api.github.com${path}`, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'grove-repo-reader/1.0 (+https://grove.so)',
        accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read the repo's docs and extract structured product knowledge.
 * Throws with a user-facing message on unreachable/empty repos.
 */
export async function syncRepoKnowledge(repoRef: string, token?: string): Promise<RepoKnowledge> {
  const ref = parseRepoRef(repoRef);
  if (!ref) throw new Error('That does not look like a GitHub repository. Use "owner/repo" or a github.com URL.');

  const meta = await gh(`/repos/${ref}`, token);
  if (meta.status === 404) {
    throw new Error(`Repository ${ref} not found. If it is private, connect it with a fine-grained access token (read-only Contents).`);
  }
  if (meta.status === 401 || meta.status === 403) {
    throw new Error('GitHub rejected the request — check the access token (it needs read-only Contents permission), or retry in a few minutes.');
  }
  if (!meta.ok) throw new Error(`GitHub API error (HTTP ${meta.status}).`);
  const repoInfo = await meta.json() as { default_branch?: string; description?: string | null };
  const branch = repoInfo.default_branch || 'main';

  const treeRes = await gh(`/repos/${ref}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  if (!treeRes.ok) throw new Error(`Could not list the repository's files (HTTP ${treeRes.status}).`);
  const tree = await treeRes.json() as { tree?: { path: string; type: string }[] };
  const allPaths = (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path);

  const docPaths = pickDocPaths(allPaths);
  if (!docPaths.length) {
    throw new Error('No readable docs found in the repository (no README or docs/*.md). Add a README and re-sync.');
  }

  const files: { path: string; text: string }[] = [];
  let total = 0;
  for (const path of docPaths) {
    if (total >= MAX_CORPUS_CHARS) break;
    try {
      const r = await gh(
        `/repos/${ref}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
        token, true,
      );
      if (!r.ok) continue;
      const text = (await r.text()).slice(0, MAX_FILE_CHARS);
      if (text.trim().length < 50) continue;
      files.push({ path, text });
      total += text.length;
    } catch { /* skip file */ }
  }
  if (!files.length) throw new Error('Could not read any doc files from the repository.');

  const corpus = files
    .map((f) => `## ${f.path}\n${f.text}`)
    .join('\n\n---\n\n')
    .slice(0, MAX_CORPUS_CHARS);

  const { text } = await llmCall({
    json: true,
    maxTokens: 3000,
    system: `You read a software product's own repository docs and extract structured
product knowledge a blog writer will use to write tutorials and feature deep-dives.

Extract ONLY what the docs actually say. Real feature names, real steps, real
flags/options/limits. Never invent a feature or a step. If setup isn't
documented, return an empty setup array.

Pick the 3-8 features most worth writing an article about — user-facing
capabilities, not internal plumbing. "how_to_use" steps must be actions a
USER takes (from the docs' usage instructions), not build/dev steps.

CRITICAL OUTPUT RULES:
- Output ONE raw JSON object. Nothing else.
- No markdown. No backticks. No code fences.
- All string values plain text, single-line — never embed code blocks.`,
    user: `Repository: ${ref}
${repoInfo.description ? `Repo description: ${repoInfo.description}` : ''}

Return JSON:
{
  "product_summary": "2-3 sentences: what this product is and does, per its own docs",
  "features": [
    {
      "name": "feature name as the docs call it",
      "what_it_does": "1-2 concrete sentences",
      "how_to_use": ["ordered user-facing step 1", "step 2", "..."],
      "details": "flags, options, limits, or configuration worth citing (single line; empty string if none)"
    }
  ],
  "concepts": ["domain term the docs use", "..."],
  "setup": ["getting-started step 1", "..."]
}

REPOSITORY DOCS:
${corpus}`,
  });

  const parsed = extractJson<any>(text);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const strArr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const features: RepoFeature[] = (Array.isArray(parsed.features) ? parsed.features : [])
    .map((f: any) => ({
      name: str(f?.name),
      what_it_does: str(f?.what_it_does),
      how_to_use: strArr(f?.how_to_use),
      details: str(f?.details),
    }))
    .filter((f: RepoFeature) => f.name && f.what_it_does)
    .slice(0, 8);

  return {
    repo: ref,
    synced_at: new Date().toISOString(),
    product_summary: str(parsed.product_summary),
    features,
    concepts: strArr(parsed.concepts).slice(0, 15),
    setup: strArr(parsed.setup).slice(0, 10),
    files_read: files.map((f) => f.path),
  };
}
