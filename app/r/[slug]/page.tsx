import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteNav from '@/components/SiteNav';
import {
  REPORTS, getReport, rankingTop50, articleSearches, winnableCount, maxRecommendedKd,
  reportSignupHref, formatReportDate, type Proof,
} from '@/lib/reports';

// A prospect report: grove's keyword research on a site whose owner hasn't
// signed up yet. Private by obscurity (random slug), never indexed, never in
// a sitemap. English only — it is written for one reader who wrote to us in
// English, like the outreach that led to it. See lib/reports.

export const dynamicParams = false;
export function generateStaticParams() {
  return REPORTS.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = getReport((await params).slug);
  if (!r) return {};
  return {
    title: { absolute: `Keyword report for ${r.domain} · Grove` },
    description: `Searches ${r.domain} can win, and the articles to write for them.`,
    robots: { index: false, follow: false, nocache: true },
  };
}

const n = (v: number) => v.toLocaleString('en-US');

const CSS = `
.gv-rep { background: #000; color: #c9ccc5; min-height: 100vh; font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
.gv-rep ::selection { background: rgba(162,255,1,0.28); color: #0a0a08; }
.gv-rep-in { max-width: 920px; margin: 0 auto; padding: 56px 24px 96px; box-sizing: border-box; }
.gv-rep h1 { font-family: 'GT Walsheim', 'Inter', sans-serif; font-weight: 500; font-size: clamp(32px, 5.4vw, 52px); line-height: 1.06; letter-spacing: -0.03em; color: #f4f4f2; margin: 14px 0 18px; }
.gv-rep h2 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #f4f4f2; margin: 0 0 8px; }
.gv-rep .rp-lead { font-size: 17px; line-height: 1.6; color: #9a9d97; max-width: 660px; margin: 0; }
.gv-rep .rp-eyebrow { font-size: 12.5px; letter-spacing: .02em; color: #84887f; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.gv-rep .rp-eyebrow b { color: #d9ff8f; font-weight: 500; }
.gv-rep section { margin-top: 72px; }
.gv-rep .rp-sub { font-size: 15px; line-height: 1.6; color: #9a9d97; margin: 0 0 24px; max-width: 640px; }
.gv-rep .rp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 40px; }
.gv-rep .rp-stat { background: #0a0a09; border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 20px; }
.gv-rep .rp-stat .rp-v { font-size: 34px; font-weight: 600; letter-spacing: -0.03em; color: #f4f4f2; line-height: 1; }
.gv-rep .rp-stat .rp-v.rp-hl { color: #a2ff01; }
.gv-rep .rp-stat .rp-l { font-size: 13px; color: #84887f; margin-top: 10px; line-height: 1.45; }
.gv-rep .rp-method { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.gv-rep .rp-step { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 16px; }
.gv-rep .rp-step .rp-k { font-family: 'DM Mono', ui-monospace, monospace; font-size: 12px; color: #a2ff01; }
.gv-rep .rp-step .rp-t { font-size: 15.5px; font-weight: 600; color: #f4f4f2; margin: 8px 0 6px; }
.gv-rep .rp-step p { font-size: 14px; line-height: 1.55; color: #9a9d97; margin: 0; }
.gv-rep .rp-arts { display: flex; flex-direction: column; gap: 10px; }
.gv-rep .rp-art { display: grid; grid-template-columns: 34px 1fr auto; gap: 16px; align-items: start; background: #0a0a09; border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 18px 20px; }
.gv-rep .rp-art .rp-no { font-family: 'DM Mono', ui-monospace, monospace; font-size: 13px; color: #6e7268; padding-top: 2px; }
.gv-rep .rp-art .rp-ti { font-size: 16.5px; font-weight: 600; color: #f4f4f2; letter-spacing: -0.01em; }
.gv-rep .rp-art .rp-kw { font-family: 'DM Mono', ui-monospace, monospace; font-size: 12.5px; color: #d9ff8f; margin-top: 6px; }
.gv-rep .rp-art .rp-why { font-size: 14px; line-height: 1.55; color: #9a9d97; margin-top: 8px; }
.gv-rep .rp-art .rp-pf { font-size: 12.5px; color: #84887f; margin-top: 8px; }
.gv-rep .rp-read { display: inline-flex; margin-top: 12px; font-size: 13.5px; font-weight: 600; color: #12160a; background: #a2ff01; border-radius: 8px; padding: 7px 12px; text-decoration: none; }
.gv-rep .rp-read:hover { filter: brightness(1.06); }
.gv-rep .rp-num { text-align: right; white-space: nowrap; }
.gv-rep .rp-num .rp-big { font-size: 20px; font-weight: 600; color: #f4f4f2; letter-spacing: -0.02em; }
.gv-rep .rp-num .rp-sm { font-size: 12px; color: #84887f; margin-top: 4px; }
.gv-rep .rp-tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.gv-rep .rp-tbl th { text-align: left; font-weight: 500; font-size: 12px; color: #6e7268; padding: 0 12px 10px 0; border-bottom: 1px solid rgba(255,255,255,0.09); }
.gv-rep .rp-tbl td { padding: 14px 12px 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; line-height: 1.5; color: #9a9d97; }
.gv-rep .rp-tbl td.rp-r, .gv-rep .rp-tbl th.rp-r { text-align: right; white-space: nowrap; }
.gv-rep .rp-tbl .rp-path { font-family: 'DM Mono', ui-monospace, monospace; font-size: 12.5px; color: #c9ccc5; }
.gv-rep .rp-tbl .rp-kwc { color: #f4f4f2; }
.gv-rep .rp-tbl .rp-dim { color: #6e7268; font-size: 12.5px; }
.gv-rep .rp-strike { color: #84887f; text-decoration: line-through; text-decoration-color: rgba(255,255,255,0.25); }
.gv-rep .rp-checks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.gv-rep .rp-checks li { display: grid; grid-template-columns: 20px 1fr; gap: 12px; font-size: 14.5px; line-height: 1.55; color: #9a9d97; }
.gv-rep .rp-checks li::before { content: ''; width: 14px; height: 14px; margin-top: 3px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,0.25); }
.gv-rep .rp-cta { margin-top: 80px; background: linear-gradient(150deg, #141613, #0b0d0a); border: 1px solid rgba(162,255,1,0.22); border-radius: 18px; padding: 36px; }
.gv-rep .rp-cta h2 { font-size: 26px; }
.gv-rep .rp-cta ul { list-style: disc; margin: 18px 0 26px; padding-left: 18px; color: #c9ccc5; font-size: 15px; line-height: 1.7; }
.gv-rep .rp-btn { display: inline-flex; align-items: center; height: 46px; padding: 0 22px; border-radius: 9px; background: #a2ff01; color: #12160a; font-weight: 600; font-size: 15px; text-decoration: none; }
.gv-rep .rp-btn:hover { filter: brightness(1.06); }
.gv-rep .rp-fine { font-size: 13px; color: #84887f; margin-top: 14px; }
.gv-rep .rp-mlab { display: none; }
.gv-rep .rp-src { margin-top: 56px; font-size: 12.5px; line-height: 1.6; color: #6e7268; }
@media (max-width: 720px) {
  .gv-rep-in { padding: 36px 16px 72px; }
  .gv-rep .rp-stats, .gv-rep .rp-method { grid-template-columns: 1fr; }
  .gv-rep .rp-art { grid-template-columns: 1fr; gap: 10px; }
  .gv-rep .rp-art .rp-no { display: none; }
  .gv-rep .rp-num { text-align: left; display: flex; gap: 14px; align-items: baseline; }
  .gv-rep .rp-tbl thead { display: none; }
  .gv-rep .rp-tbl tr { display: block; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .gv-rep .rp-tbl td { display: block; padding: 2px 0; border: none; text-align: left !important; }
  .gv-rep .rp-cta { padding: 26px 20px; }
  .gv-rep .rp-mlab { display: inline; }
}
`;

function proofLine(p: Proof) {
  return `${p.site} ranks #${p.position} with ${p.pageType}`;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const r = getReport((await params).slug);
  if (!r) notFound();

  const signup = reportSignupHref(r);
  const top50 = rankingTop50(r);
  const searches = articleSearches(r);
  const winnable = winnableCount(r);
  const drafted = r.articles.filter((a) => a.draft).length;

  return (
    <div className="gv-rep">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <SiteNav ctaLabel="Get these written" ctaHref={signup} />
      <main className="gv-rep-in">
        <div className="rp-eyebrow">
          <span><b>Keyword report</b></span>
          <span>{r.domain}</span>
          <span>Researched {formatReportDate(r.researchedOn)}</span>
          <span>Prepared by {r.preparedBy}</span>
        </div>
        <h1>Google ranks {r.domain} for {r.currentRanks.length} searches. Here are {winnable} it can win.</h1>
        <p className="rp-lead">
          Most of your pages are already the right kind of page. Google just doesn&apos;t trust the domain yet,
          and a few pages are aimed at words nobody types. This report shows what sites your size already win,
          which searches bring buyers, and the {r.articles.length} articles to write first.
        </p>

        <div className="rp-stats">
          <div className="rp-stat">
            <div className="rp-v">{r.currentRanks.length}</div>
            <div className="rp-l">searches {r.domain} ranks for today, {top50 === 0 ? 'none' : top50} in the top 50</div>
          </div>
          <div className="rp-stat">
            <div className="rp-v rp-hl">{winnable}</div>
            <div className="rp-l">winnable searches found, all at difficulty {maxRecommendedKd(r)} or lower out of 100</div>
          </div>
          <div className="rp-stat">
            <div className="rp-v">{n(searches)}</div>
            <div className="rp-l">searches a month behind the {r.articles.length} recommended articles</div>
          </div>
        </div>

        <section>
          <h2>How Grove picked these</h2>
          <p className="rp-sub">A list sorted by search volume would have told you to write &ldquo;what is an MCP server&rdquo;. These three filters are why it doesn&apos;t.</p>
          <div className="rp-method">
            <div className="rp-step">
              <div className="rp-k">01 · Peer gap</div>
              <div className="rp-t">What sites your size already win</div>
              <p>We pulled the top-20 rankings of {r.peers.length} social media tools and kept searches where a small one, not Buffer, holds a spot.</p>
            </div>
            <div className="rp-step">
              <div className="rp-k">02 · Buyer filter</div>
              <div className="rp-t">Who is searching</div>
              <p>High volume and low difficulty isn&apos;t enough. We cut searches whose readers won&apos;t ever buy a scheduler.</p>
            </div>
            <div className="rp-step">
              <div className="rp-k">03 · Page check</div>
              <div className="rp-t">What you already have</div>
              <p>Where an existing page fits a search, we retarget it instead of writing a new one that competes with it.</p>
            </div>
          </div>
        </section>

        <section>
          <h2>Write these first</h2>
          <p className="rp-sub">Ordered by how close the reader is to buying. Difficulty is 0 to 100; under 30 is realistic for a new domain. {drafted > 0 && ` Grove has already drafted ${drafted === 1 ? 'one' : `the first ${['', 'one', 'two', 'three', 'four', 'five', 'six'].at(drafted) ?? drafted}`}, so you can judge the writing, not a promise.`}</p>
          <div className="rp-arts">
            {r.articles.map((a, i) => (
              <div className="rp-art" key={a.target.keyword}>
                <div className="rp-no">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div className="rp-ti">{a.title}</div>
                  <div className="rp-kw">{a.target.keyword}{a.also?.length ? ` + ${a.also.map((k) => k.keyword).join(', ')}` : ''}</div>
                  <div className="rp-why">{a.why}</div>
                  {a.proof && <div className="rp-pf">{proofLine(a.proof)}</div>}
                  {a.draft && <a className="rp-read" href={`/r/${r.slug}/a/${a.draft.slug}`}>Read the draft Grove wrote &rarr;</a>}
                </div>
                <div className="rp-num">
                  <div className="rp-big">{n(a.target.volume)}</div>
                  <div className="rp-sm">searches / mo · difficulty {a.target.kd}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Fix these pages before writing anything</h2>
          <p className="rp-sub">Each page exists today. Put the target phrase in the title, the H1 and the first sentence. A few hours of work, no new content.</p>
          <table className="rp-tbl">
            <thead>
              <tr><th>Page</th><th>Aim it at</th><th className="rp-r">Searches / mo</th><th>What to change</th></tr>
            </thead>
            <tbody>
              {r.retargets.map((t) => (
                <tr key={t.path}>
                  <td className="rp-path">{t.path}</td>
                  <td className="rp-kwc">{t.target.keyword} <span className="rp-dim">· difficulty {t.target.kd}</span></td>
                  <td className="rp-r">{n(t.target.volume)}<span className="rp-mlab"> searches / mo</span></td>
                  <td>{t.change}{t.proof && <div className="rp-dim">{proofLine(t.proof)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Skip these, even though the numbers look good</h2>
          <p className="rp-sub">This is what a volume-first tool would hand you. Big and easy, but the people searching won&apos;t buy.</p>
          <table className="rp-tbl">
            <thead>
              <tr><th>Search</th><th className="rp-r">Searches / mo</th><th>Why skip</th></tr>
            </thead>
            <tbody>
              {r.skips.map((s) => (
                <tr key={s.keyword}>
                  <td className="rp-strike">{s.keyword}</td>
                  <td className="rp-r">{n(s.volume)}<span className="rp-mlab"> searches / mo</span> <span className="rp-dim">· difficulty {s.kd}</span></td>
                  <td>{s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Before any of it works: trust</h2>
          <p className="rp-sub">New pages on an untrusted domain sit unranked like the ones you have. Do these alongside the fixes above.</p>
          <ul className="rp-checks">
            {r.trust.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>

        <div className="rp-cta">
          <h2>Want Grove to write the {r.articles.length} articles?</h2>
          <ul>
            <li>Grove drafts each one in your voice, and you approve every one before it goes anywhere.</li>
            <li>Approved articles arrive in your blog&apos;s repo through Grove&apos;s MCP server, so Claude Code commits them like any other change.</li>
            <li>Connect Search Console and Grove tracks these searches weekly, then re-plans each month from what Google actually shows you for.</li>
          </ul>
          <a className="rp-btn" href={signup}>Start with {r.domain}</a>
          <div className="rp-fine">The first month is free. Or just reply to Tae on X with questions.</div>
        </div>

        <p className="rp-src">
          Data: {r.source} Pulled {formatReportDate(r.researchedOn)}. Competitors scanned: {r.peers.join(', ')}.
          Your current rankings: {r.currentRanks.map((c) => `${c.keyword} (#${c.position})`).join(', ')}.
        </p>
      </main>
    </div>
  );
}
