import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { stripLeadingH1 } from '@/lib/article-body';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { language, readMinutes } from '@/lib/language';
import { draftParams, getDraft, reportSignupHref } from '@/lib/reports';
import { draftMarkdown, checkDraft, researchFor, fillInCount } from '@/lib/reports/articles';

// A sample article Grove wrote for a prospect, rendered in the same article
// template (globals.css .post-shell / .prose / .toc-rail) a published Grove
// post uses, under a bar that says plainly it's an unpublished draft. Never
// indexed: if the prospect publishes it, their copy must be the only one.

export const dynamicParams = false;
export function generateStaticParams() {
  return draftParams();
}

type Params = { params: Promise<{ slug: string; article: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, article } = await params;
  const d = getDraft(slug, article);
  if (!d) return {};
  return {
    title: { absolute: `${d.rec.title} · draft for ${d.report.domain} · Grove` },
    description: d.rec.draft?.description,
    robots: { index: false, follow: false, nocache: true },
  };
}

const n = (v: number) => v.toLocaleString('en-US');

const CSS = `
.gv-draft { background: var(--paper); min-height: 100vh; }
.gv-draft-bar { background: #0a0a09; color: #c9ccc5; font-family: 'Inter', sans-serif; font-size: 13px; }
.gv-draft-bar-in { max-width: 1060px; margin: 0 auto; padding: 12px 28px; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.gv-draft-bar a { color: #d9ff8f; text-decoration: none; }
.gv-draft-bar .tag { color: #12160a; background: #a2ff01; border-radius: 999px; padding: 3px 10px; font-weight: 600; font-size: 12px; }
.gv-draft-bar .muted { color: #84887f; }
.gv-gate { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
.gv-gate span { font-family: 'DM Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--ink); background: var(--surface, white); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; }
.gv-gate span.ok { color: var(--moss2, #2f7a4d); border-color: rgba(63,143,94,0.35); }
.prose .gv-fillin { display: block; background: #fff8db; border: 1px dashed #d8b84a; border-radius: 10px; padding: 12px 14px; color: #5a4a12; font-size: 15px; }
.prose .gv-fillin b { color: #3d320b; }
.gv-draft-cta { margin-top: 34px; background: #0a0a09; color: #c9ccc5; border-radius: 18px; padding: 28px; font-family: 'Inter', sans-serif; }
.gv-draft-cta h3 { color: #f4f4f2; font-size: 21px; margin: 0 0 8px; letter-spacing: -0.01em; }
.gv-draft-cta p { margin: 0 0 18px; font-size: 15px; line-height: 1.6; }
.gv-draft-cta a.btn { display: inline-flex; align-items: center; height: 44px; padding: 0 20px; border-radius: 9px; background: #a2ff01; color: #12160a; font-weight: 600; text-decoration: none; }
.gv-draft-src { margin-top: 30px; font-family: 'Inter', sans-serif; font-size: 13px; color: var(--clay); line-height: 1.6; }
.gv-draft-src ol { padding-left: 18px; margin: 8px 0 0; }
.gv-draft-src a { color: var(--ink); }
@media (max-width: 720px) { .gv-draft-bar-in { padding: 12px 16px; } .gv-draft-cta { padding: 22px 18px; } }
`;

export default async function Page({ params }: Params) {
  const { slug, article } = await params;
  const d = getDraft(slug, article);
  const draft = d?.rec.draft;
  if (!d || !draft) notFound();
  const { report, rec } = d;

  const md = draftMarkdown(draft.file);
  const businessName = report.business;
  const { validation, blocking } = checkDraft(md, { title: rec.title, businessName, domain: report.domain });
  const lg = language('en');
  const body = stripLeadingH1(md);
  const toc = extractToc(body);
  // The owner's line, shown as a visible slot rather than invented experience.
  const html = mdToHtml(body).replace(
    /\[(?:[A-Z][\w-]*(?: [\w-]+)? team|INSERT EXPERIENCE): ([^\]]+)\]/g,
    (_m, ask: string) => `<span class="gv-fillin"><b>Your line goes here:</b> ${ask}</span>`,
  );
  const fills = fillInCount(md);
  const sources = researchFor(report.domain).filter((s) => md.includes(s.url));
  const signup = reportSignupHref(report);
  const backHref = `/r/${report.slug}`;
  const genre = genreFor('comparison', rec.title, 'en');
  const author = authorFor({ business: { name: businessName } }, report.domain, 'en');
  const s = validation.stats;

  return (
    <div className="gv-draft">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="gv-draft-bar">
        <div className="gv-draft-bar-in">
          <span className="tag">Draft by Grove</span>
          <span>For {report.domain}, not published</span>
          <span className="muted">Target search: {rec.target.keyword} · {n(rec.target.volume)}/mo · difficulty {rec.target.kd}</span>
          <a href={backHref}>&larr; Back to the report</a>
        </div>
      </div>

      <main className="post-shell" lang="en">
        <div className="post-grid">
          <div className="post-main">
            <h1 className="display" style={{ fontSize: 'clamp(29px, 6.5vw, 46px)' }}>{rec.title}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--moss)', background: 'var(--accent-soft, rgba(89,148,94,0.10))', borderRadius: 999, padding: '3px 10px' }}>
                {genre.label}
              </span>
              <p className="mono" style={{ color: 'var(--clay)', fontSize: 12, margin: 0 }}>
                {lg.ui.by(author)} · {lg.ui.readTime(readMinutes(md, lg))}
              </p>
            </div>
            <div className="gv-gate" aria-label="Grove quality gate">
              <span className={blocking.length === 0 ? 'ok' : undefined}>
                {blocking.length === 0 ? 'Passed Grove’s publish gate' : `${blocking.length} blocking issues`}
              </span>
              <span>{n(s.word_count)} words</span>
              <span>{s.citation_count} sourced links</span>
              <span>{s.faq_count} FAQ answers</span>
              {fills > 0 && <span>{fills === 1 ? '1 line for you to add' : `${fills} lines for you to add`}</span>}
            </div>

            <article
              className="prose"
              style={{ marginTop: 26, padding: 'clamp(22px, 5vw, 44px) clamp(16px, 4.5vw, 40px)', background: 'var(--surface, white)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg, 18px)', boxShadow: 'var(--sh-md)', maxWidth: 'none' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />

            <aside className="gv-draft-cta">
              <h3>Publish this on {report.domain}?</h3>
              <p>
                Grove wrote this to its own brief and checked it with the same gate every Grove article passes.
                Connect {report.domain} and it lands in your review queue, or straight into your repo through
                Grove&apos;s MCP server. Nothing goes live until you approve it.
              </p>
              <a className="btn" href={signup}>Start with {report.domain}</a>
            </aside>

            {sources.length > 0 && (
              <div className="gv-draft-src">
                <strong>Research Grove used for this draft</strong> (vendor pages, checked November 2026):
                <ol>
                  {sources.map((src) => (
                    <li key={src.url}><a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a></li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {toc.length >= 2 && (
            <aside className="toc-rail" aria-label="Table of contents">
              <div className="toc-title">{lg.ui.onThisPage}</div>
              <ol>
                {toc.map((item, i) => (
                  <li key={`${item.id}-${i}`} className={item.level === 3 ? 'lvl3' : undefined}>
                    <a href={`#${item.id}`}>{item.text}</a>
                  </li>
                ))}
              </ol>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
