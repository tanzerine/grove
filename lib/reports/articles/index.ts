/**
 * Sample drafts for prospect reports. Each article is plain markdown in this
 * folder, written to grove's writer brief in comparison mode and held to
 * grove's validator by tests/report-articles.test.ts — so a draft that would
 * fail the real publish gate fails the build instead of reaching a prospect.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validatePost, blockingIssues, type Validation } from '../../pipeline/validator';
import { KREVAYA_RESEARCH, researchText, type ResearchSource } from './research';

const DIR = path.join(process.cwd(), 'lib', 'reports', 'articles');

export function draftMarkdown(file: string): string {
  // file names come from the typed report modules, never from the URL
  if (!/^[a-z0-9-]+\.md$/.test(file)) throw new Error(`bad draft file name: ${file}`);
  return fs.readFileSync(path.join(DIR, file), 'utf8');
}

/** The research each report's drafts were written from. */
export function researchFor(domain: string): ResearchSource[] {
  return domain === 'krevaya.com' ? KREVAYA_RESEARCH : [];
}

export type DraftCheck = { validation: Validation; blocking: string[] };

/** Run grove's own validator exactly as generate.ts does for a comparison. */
export function checkDraft(md: string, opts: { title: string; businessName: string; domain: string }): DraftCheck {
  const validation = validatePost(md, {
    lang: 'en',
    title: opts.title,
    intent: 'conversion',
    format: 'comparison',
    businessName: opts.businessName,
    researchText: researchText(researchFor(opts.domain)),
  });
  return { validation, blocking: blockingIssues(validation) };
}

/** `[Krevaya team: …]` / `[INSERT EXPERIENCE: …]` — the line only the owner
 *  can write. Grove's writer leaves these instead of inventing experience. */
export const FILL_IN = /\[(?:[A-Z][\w-]*(?: [\w-]+)? team|INSERT EXPERIENCE): ([^\]]+)\]/g;

export function fillInCount(md: string): number {
  return (md.match(FILL_IN) ?? []).length;
}
