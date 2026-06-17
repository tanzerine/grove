import GroveMark from './GroveMark';
import PlantForm from './PlantForm';
import SampleTabs from './SampleTabs';
import PriceToggle from './PriceToggle';
import Faq from './Faq';

export default function Landing({ loggedIn = false }: { loggedIn?: boolean }) {
  return (
    <>
      <GroveMark />

      {/* NAV */}
      <header className="nav" id="nav">
        <div className="wrap nav-in">
          <a href="#top" className="brand">
            <span className="mark"><svg viewBox="0 0 32 32"><use href="#grove-mark" /></svg></span>
            grove<span className="dot">.</span>
          </a>
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#writes">Samples</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-cta">
            {loggedIn ? (
              <a href="/dashboard" className="btn btn-primary btn-sm">Dashboard <span className="arrow">→</span></a>
            ) : (
              <>
                <a href="/login" className="signin">Sign in</a>
                <a href="#pricing" className="btn btn-primary btn-sm">Start free <span className="arrow">→</span></a>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        {/* HERO */}
        <section className="lz-hero">
          <div className="lz-aurora"><i className="lz-a1" /><i className="lz-a2" /><i className="lz-a3" /></div>
          <div className="wrap">
            <div className="lz-in">
              <span className="eyebrow pill"><span className="pdot" />SEO + answer-engine content, on autopilot</span>
              <h1 className="display">
                Plant your domain.<br />
                The blog <span className="ital">grows itself.</span>
              </h1>
              <p className="lz-sub">
                grove reads the live SERP, writes content engineered to rank on Google and get quoted by
                ChatGPT &amp; AI Overviews, and publishes it to your site — automatically.
              </p>
              <div className="lz-ctarow"><PlantForm id="plantForm" /></div>
              <div className="proof">
                <div className="avatars"><span>JL</span><span>MR</span><span>AK</span><span>SP</span><span>TW</span></div>
                <div className="proof-txt">
                  <div className="stars">★★★★★</div>
                  <span><b>2,400+ teams</b> compounding organic + AI-search traffic</span>
                </div>
              </div>
            </div>

            <div className="lz-shot">
              <div className="lz-chip a">
                <span className="ic" style={{ background: 'rgba(108,201,138,0.18)', color: 'var(--moss)' }}>✓</span>
                <span><span className="k" style={{ display: 'block' }}>AI-search ready</span><span className="v">9 / 12 posts</span></span>
              </div>
              <div className="lz-chip b">
                <span className="ic" style={{ background: 'rgba(221,155,42,0.18)', color: '#9b6b13' }}>↗</span>
                <span><span className="k" style={{ display: 'block' }}>Organic traffic</span><span className="v">+312%</span></span>
              </div>
              <div className="lz-frame">
                <div className="lz-bar"><span className="lz-dots"><i /><i /><i /></span><span className="lz-addr">app.grove.so/pipeline</span></div>
                <div className="lz-app">
                  <div className="lz-side">
                    <div className="lz-sb on"><span className="i" />Pipeline</div>
                    <div className="lz-sb"><span className="i" />Published</div>
                    <div className="lz-sb"><span className="i" />Brand voice</div>
                    <div className="lz-sb"><span className="i" />Analytics</div>
                  </div>
                  <div className="lz-main">
                    <div className="lz-mtop"><h4>Content pipeline</h4><span className="m">4 posts / week · autopilot on</span></div>
                    <div className="lz-pr"><span className="th" /><div className="b"><div className="t">10 onboarding mistakes killing activation</div><div className="mm">Published · 1,204 reads · ranks #3 “saas onboarding”</div></div><span className="lz-tg l">LIVE</span></div>
                    <div className="lz-pr"><span className="th" /><div className="b"><div className="t">How we cut churn 31% with lifecycle email</div><div className="mm">Drafting section 3 of 6 · checking sources</div></div><span className="lz-tg w">WRITING</span></div>
                    <div className="lz-pr"><span className="th" /><div className="b"><div className="t">A founder’s guide to programmatic SEO</div><div className="mm">Researching · reading the live SERP</div></div><span className="lz-tg q">QUEUED</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lz-band">
          <div className="lz-band-in">
            <div className="lz-stat"><div className="n">+312%</div><div className="l">organic traffic · 90 days</div></div>
            <div className="lz-stat"><div className="n">2,400+</div><div className="l">teams growing on grove</div></div>
            <div className="lz-stat"><div className="n">4 / wk</div><div className="l">published on autopilot</div></div>
            <div className="lz-stat"><div className="n">4.9★</div><div className="l">average rating</div></div>
          </div>
        </section>

        <section className="section">
          <div className="wrap problem">
            <p className="q">You know content is how SaaS compounds. But it&apos;s 11pm, the blog hasn&apos;t been touched in four months, and &quot;write a post this week&quot; has been on your list since spring.</p>
            <p className="stop">So it never gets done.</p>
            <p className="turn">grove flips it. Set your domain once and <span className="ital">posts just start appearing</span> — researched, written, and published — while you build the actual product.</p>
          </div>
        </section>

        <section className="section section--alt" id="how">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow moss">Setup, end to end</span>
              <h2 className="h2">Three steps. Then you <span className="ital">never touch it</span> again.</h2>
              <p className="lede" style={{ marginLeft: 'auto', marginRight: 'auto' }}>No hosting to configure, no plugins to install, no credentials to manage.</p>
            </div>
            <div className="steps">
              <Step n="STEP 01" h="Enter your domain" p="Tell grove where you live on the web. One field, one time.">
                <div className="mini-input">https://<span style={{ color: 'var(--ink)' }}>yourdomain.com</span><span className="cur" /></div>
              </Step>
              <Step n="STEP 02" h="Verify ownership" p="Paste one DNS record or drop a file at your site root. ~2 minutes.">
                <div className="mini-rec"><span className="k">TXT</span>grove-verify=<span className="v">a8f3c…verified ✓</span></div>
              </Step>
              <Step n="STEP 03" h="Posts go live" p="grove provisions everything and starts publishing on your schedule.">
                <div className="mini-rec" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="mini-live"><span className="pulse" /></span>
                  <span>blog.yourdomain.com · <span className="v">live</span></span>
                </div>
              </Step>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow">Under the canopy</span>
              <h2 className="h2">A whole content team, <span className="ital">working invisibly.</span></h2>
              <p className="lede" style={{ marginLeft: 'auto', marginRight: 'auto' }}>Every job a senior SEO and a content team would own — SERP research, voice, writing, optimization, distribution, measurement — running on its own.</p>
            </div>
            <div className="lz-bento">
              <div className="lz-bcard lz-w">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg></div>
                <h3>Live SERP analysis</h3>
                <p>For every keyword, grove reads the pages actually ranking, distills the subtopics they all cover, and briefs the writer to out-write them — then flags any gap before you publish.</p>
                <div className="lz-mini">
                  <div className="mh">WHAT&apos;S RANKING FOR “POUR OVER COFFEE”</div>
                  <div className="lz-cov"><span className="ok">✓ grind size</span><span className="ok">✓ burr grinder</span><span className="gap">+ water temp</span><span className="gap">+ bloom phase</span><span className="ok">✓ ratio</span></div>
                </div>
              </div>
              <div className="lz-bcard lz-2">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18" /><path d="M5 8l7-5 7 5" /><path d="M5 16l7 5 7-5" /></svg></div>
                <h3>Answer-engine ready</h3>
                <p>Answer-first, a real FAQ, full schema — built the way ChatGPT, Perplexity &amp; AI Overviews quote.</p>
              </div>
              <div className="lz-bcard lz-2">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" /></svg></div>
                <h3>Writes in your voice</h3>
                <p>grove reads your site to learn your tone, then writes E-E-A-T content that sounds like you — not AI mush.</p>
              </div>
              <div className="lz-bcard lz-2">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16l4-6 4 3 4-7" /></svg></div>
                <h3>Ranking, in plain English</h3>
                <p>See what each post earns and an AI-search readiness score — no Search Console spreadsheet required.</p>
              </div>
              <div className="lz-bcard lz-2">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 11l8-4M8 13l8 4" /></svg></div>
                <h3>Cross-posts everywhere</h3>
                <p>Each post becomes an X thread, a LinkedIn post, and an Instagram caption — native to each, not copy-paste.</p>
              </div>
              <div className="lz-bcard lz-6">
                <div className="lz-bfic"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg></div>
                <h3>Publishes itself on your domain</h3>
                <p>Straight to a managed blog on your domain — SSL, sitemaps, structured data, llms.txt, RSS — so search engines and AI crawlers find it automatically. You approve each post, or let it run.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="writes">
          <div className="wrap writes">
            <div className="writes-copy">
              <span className="eyebrow moss">One post, every channel</span>
              <h2 className="h2">Write once.<br />grove <span className="ital">replants it</span> everywhere.</h2>
              <p className="lede">From a single brief, grove produces a full SEO blog post and reshapes it for every platform you care about — each one native, none of it copy-paste.</p>
              <SampleTabs />
            </div>
          </div>
        </section>

        <section className="section section--ink">
          <div className="wrap deep">
            <div className="deep-copy">
              <span className="eyebrow">You&apos;re still in control</span>
              <h2 className="h2">Autopilot, <span className="ital">not autopilot you can&apos;t see.</span></h2>
              <p className="lede">grove can publish fully hands-off — or hold every post for your one-tap approval. Your call, per post or for good.</p>
              <ul className="deep-list">
                <li><span className="ck">✓</span><span><b>Review queue</b> — approve, tweak a line, or send back with a note before anything goes live.</span></li>
                <li><span className="ck">✓</span><span><b>Full auto mode</b> — trust it once and let posts publish on schedule without you.</span></li>
                <li><span className="ck">✓</span><span><b>Topic memory</b> — grove tracks everything it&apos;s published so it never repeats itself.</span></li>
              </ul>
            </div>
            <div className="deep-art">
              <div className="queue">
                <h5>Awaiting your review · 2</h5>
                <Qrow t="How we cut churn 31% with lifecycle email" m="1,840 words · 5 sources · scheduled Tue 9am" />
                <Qrow t="A founder's guide to programmatic SEO" m="2,210 words · 11 sources · scheduled Fri 9am" />
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="pricing">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow moss">Plans</span>
              <h2 className="h2">Cheaper than <span className="ital">one freelance post.</span></h2>
              <p className="lede" style={{ marginLeft: 'auto', marginRight: 'auto' }}>A single ghost-written SEO article runs $150–400. grove writes a month of them for less.</p>
              <PriceToggle />
            </div>
          </div>
        </section>

        <section className="section section--alt" id="faq">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow moss">Questions</span>
              <h2 className="h2">The honest <span className="ital">FAQ.</span></h2>
            </div>
            <Faq />
          </div>
        </section>

        <section className="lz-ctab">
          <div className="wrap">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>Start growing</span>
            <h2 className="h2" style={{ marginTop: 16 }}>
              Your blog is one <span className="ital">field away.</span>
            </h2>
            <PlantForm id="plantForm2" />
            <p className="cta-foot">14-day free trial · cancel anytime · first post live in minutes</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <a href="#top" className="brand">
                <span className="mark"><svg viewBox="0 0 32 32"><use href="#grove-mark" /></svg></span>
                grove<span className="dot">.</span>
              </a>
              <p>Content that keeps growing. Plant your domain once — we research, write, and publish the rest.</p>
              <a href="/signup" className="btn btn-primary btn-sm">Start free <span className="arrow">→</span></a>
            </div>
            <div className="foot-col">
              <h5>Product</h5>
              <a href="#how">How it works</a><a href="#features">Features</a><a href="#writes">Samples</a><a href="#pricing">Pricing</a>
            </div>
            <div className="foot-col">
              <h5>Company</h5>
              <a href="#">About</a><a href="#">Blog</a><a href="#">Careers</a><a href="#">Contact</a>
            </div>
            <div className="foot-col">
              <h5>Legal</h5>
              <a href="#">Privacy</a><a href="#">Terms</a><a href="#">Security</a><a href="#">Status</a>
            </div>
          </div>
          <div className="foot-bot">
            <span>© 2026 grove. Grown, not generated.</span>
            <span className="mono">made for builders who&apos;d rather build</span>
          </div>
        </div>
      </footer>
    </>
  );
}

function Step({ n, h, p, children }: { n: string; h: string; p: string; children: React.ReactNode }) {
  return (
    <div className="step">
      <div className="snum">{n}</div>
      <h3>{h}</h3>
      <p>{p}</p>
      <div className="mini">{children}</div>
    </div>
  );
}


function Qrow({ t, m }: { t: string; m: string }) {
  return (
    <div className="qrow">
      <div className="qthumb" />
      <div className="qb">
        <div className="qt">{t}</div>
        <div className="qm">{m}</div>
      </div>
      <div className="qact">
        <button className="qbtn">Edit</button>
        <button className="qbtn go">Approve</button>
      </div>
    </div>
  );
}
