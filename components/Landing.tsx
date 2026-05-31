import GroveMark from './GroveMark';
import PlantForm from './PlantForm';
import SampleTabs from './SampleTabs';
import PriceToggle from './PriceToggle';
import Faq from './Faq';

export default function Landing() {
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
            <a href="/login" className="signin">Sign in</a>
            <a href="#pricing" className="btn btn-primary btn-sm">Start free <span className="arrow">→</span></a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* HERO */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">SEO blog engine · on autopilot</span>
              <h1 className="display">
                Plant your domain.<br />
                The blog <span className="ital">grows itself.</span>
              </h1>
              <p className="lede">
                grove researches, writes, and publishes SEO blog posts straight to your site — automatically.
                Enter your domain once. That&apos;s the entire setup. No WordPress, no API keys, no calendar.
              </p>

              <PlantForm id="plantForm" />

              <div className="proof">
                <div className="avatars"><span>JL</span><span>MR</span><span>AK</span><span>SP</span><span>TW</span></div>
                <div className="proof-txt">
                  <div className="stars">★★★★★</div>
                  <span><b>2,400+ founders</b> grow their blog on autopilot</span>
                </div>
              </div>
            </div>

            <div className="hero-art">
              <div className="window">
                <div className="window-bar">
                  <div className="tl"><i /><i /><i /></div>
                  <div className="url">🔒 app.grove.so/pipeline</div>
                </div>
                <div className="dash">
                  <aside className="dash-side">
                    <div className="sb-brand">
                      <span className="mark"><svg viewBox="0 0 32 32"><use href="#grove-mark" /></svg></span>
                      grove<span className="dot">.</span>
                    </div>
                    <div className="sb-item on"><span className="ic" />Pipeline</div>
                    <div className="sb-item"><span className="ic" />Published</div>
                    <div className="sb-item"><span className="ic" />Brand voice</div>
                    <div className="sb-item"><span className="ic" />Analytics</div>
                    <div className="sb-foot">
                      <div className="verified-chip"><span className="v">✓</span>linear.app verified</div>
                    </div>
                  </aside>
                  <div className="dash-main">
                    <div className="dm-top">
                      <h4>Content pipeline</h4>
                      <span className="meta">4 posts / week</span>
                    </div>
                    <PostRow title="10 onboarding mistakes killing your activation" meta='Published · 1,204 reads · ranks #3 "saas onboarding"' badge="live" badgeText="LIVE" />
                    <PostRow title="How we cut churn 31% with lifecycle email" meta="Drafting section 3 of 6 · fact-checking…" badge="writing" badgeText="WRITING" />
                    <PostRow title="The indie hacker's guide to programmatic SEO" meta="Researching · 14 sources gathered" badge="queue" badgeText="QUEUED" />
                    <div className="dash-stat">
                      <div>
                        <div className="num"><b>+312%</b></div>
                        <div className="lbl">organic traffic · 90 days</div>
                      </div>
                      <svg className="spark" viewBox="0 0 120 38" preserveAspectRatio="none">
                        <polyline points="0,34 18,32 34,30 52,24 70,21 88,13 104,9 120,3" fill="none" stroke="#4e9e6a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="logos">
          <div className="wrap">
            <div className="logos-lbl">Trusted by builders shipping content while they sleep</div>
            <div className="logos-row">
              {['Northwind', 'Loomly', 'Stacker', 'Cadence', 'Pebble', 'Driftwood'].map((n) => (
                <span className="logo-item" key={n}><span className="gl" />{n}</span>
              ))}
            </div>
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
            <div className="sec-head">
              <span className="eyebrow">Under the canopy</span>
              <h2 className="h2">A whole content team, <span className="ital">working invisibly.</span></h2>
              <p className="lede">Every part of the workflow a marketing hire would own — research, voice, writing, publishing, distribution, measurement — runs on its own.</p>
            </div>
            <div className="feat-grid">
              <Feat title="Topic research" body="Scans search demand and competitor gaps to pick keywords you can actually rank for — then gathers real, citable sources." />
              <Feat title="Brand voice profiling" body="On signup grove reads your existing site, extracts your tone and vocabulary, and writes in your voice every time after." />
              <Feat title="Human-grade writing" body="First-person experience, real examples, primary-source citations — prose written to pass Google's E-E-A-T." />
              <Feat title="Auto-publishing" body="Posts go straight to a managed blog on your subdomain — SSL, sitemap, meta tags, structured data all handled." />
              <Feat title="Cross-post everywhere" body="Each post ships as an X thread, a LinkedIn post, and an Instagram caption — written for each platform, not copy-pasted." />
              <Feat title="Ranking analytics" body="See which posts climb, what they rank for, and the traffic each one earns — no Search Console spreadsheet required." />
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

        <section className="section cta">
          <div className="wrap">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>Start growing</span>
            <h2 className="h2" style={{ marginTop: 16, maxWidth: '14ch', marginLeft: 'auto', marginRight: 'auto' }}>
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

function PostRow({ title, meta, badge, badgeText }: { title: string; meta: string; badge: string; badgeText: string }) {
  return (
    <div className="post-row">
      <div className="pthumb" />
      <div className="pbody">
        <div className="ptitle">{title}</div>
        <div className="pmeta">{meta}</div>
      </div>
      <span className={`badge ${badge}`}><span className="d" />{badgeText}</span>
    </div>
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

function Feat({ title, body }: { title: string; body: string }) {
  return (
    <div className="feat">
      <div className="fic">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2d7a4f" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="7" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
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
