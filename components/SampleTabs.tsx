'use client';
import { useState } from 'react';

const TABS = [
  { id: 'blog', label: 'Blog post' },
  { id: 'x', label: 'X thread' },
  { id: 'li', label: 'LinkedIn' },
] as const;

export default function SampleTabs() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('blog');
  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="pic" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="write-panel" style={{ gridColumn: '2', marginTop: 0 }} />
      <SamplePanels active={tab} />
    </>
  );
}

function SamplePanels({ active }: { active: string }) {
  return (
    <div className="write-panel" style={{ gridColumn: 2 }}>
      <div className={`sample ${active === 'blog' ? 'on' : ''}`}>
        <div className="blog-card">
          <div className="blog-hero">
            <span className="tag">blog.yourdomain.com</span>
          </div>
          <div className="blog-body">
            <h3>10 onboarding mistakes quietly killing your activation rate</h3>
            <div className="blog-meta">
              <span>8 min read</span>
              <span className="seo">● SEO score 94</span>
              <span>4 sources cited</span>
            </div>
            <p>
              I rebuilt our onboarding three times before activation moved. The first two redesigns failed for the same reason — we were optimizing the screens users <em>saw</em>, not the moment they got stuck.
            </p>
            <p>
              Here&apos;s what actually moved the number, with the data to back it up. <span className="src">[1] firstpageapp.com/study</span>
            </p>
          </div>
        </div>
      </div>

      <div className={`sample ${active === 'x' ? 'on' : ''}`}>
        <SocialCard
          name="Jordan Lee"
          handle="@jordanbuilds"
          platform="X · thread"
          body={
            <>
              <p><span className="thread-num">1/</span> Rebuilt our onboarding 3 times before activation moved.</p>
              <p>The first two failed for the same reason. 🧵</p>
              <p><span className="thread-num">2/</span> We kept fixing the screens people saw. The real problem was the screen they got stuck on — and never came back from.</p>
            </>
          }
          stats={<><span><b>342</b> reposts</span><span><b>1.9k</b> likes</span><span><b>88k</b> views</span></>}
        />
      </div>

      <div className={`sample ${active === 'li' ? 'on' : ''}`}>
        <SocialCard
          name="Jordan Lee"
          handle="Founder · grove"
          platform="LinkedIn"
          body={
            <>
              <p>We rebuilt onboarding three times before activation finally moved.</p>
              <p>Two of those rebuilds were a complete waste — and the lesson cost us a quarter.</p>
              <p>Here&apos;s the framework I&apos;d give my past self, and the activation data that proves it out 👇</p>
            </>
          }
          stats={<><span><b>214</b> reactions</span><span><b>61</b> comments</span></>}
        />
      </div>
    </div>
  );
}

function SocialCard(props: { name: string; handle: string; platform: string; body: React.ReactNode; stats?: React.ReactNode }) {
  return (
    <div className="social-card">
      <div className="sc-head">
        <div className="sc-av">JL</div>
        <div>
          <div className="sc-name">{props.name}</div>
          <div className="sc-handle">{props.handle}</div>
        </div>
        <span className="sc-plat">{props.platform}</span>
      </div>
      <div className="sc-body">{props.body}</div>
      {props.stats && <div className="sc-stats">{props.stats}</div>}
    </div>
  );
}
