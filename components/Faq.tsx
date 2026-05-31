'use client';
import { useState } from 'react';

const ITEMS = [
  { q: 'Do I need WordPress or any hosting?', a: 'No. grove provisions and manages a blog for you on a subdomain of your site (like blog.yourdomain.com), with SSL, sitemaps, and SEO tags all handled. You never see a CMS, an API key, or a server.' },
  { q: 'Will the posts actually sound like me?', a: 'On signup grove reads your existing site to learn your tone, vocabulary, and the topics you care about, then writes every post against that profile. You can refine the voice anytime.' },
  { q: 'Isn’t AI content bad for SEO now?', a: 'Generic AI content is. grove writes to a strict E-E-A-T rule set — first-person experience, primary-source citations, real examples, honest nuance, and human sentence rhythm.' },
  { q: 'Can I review posts before they go live?', a: 'Yes. Every post lands in a review queue where you can approve, edit, or send it back with a note. Prefer true autopilot? Flip on full-auto mode.' },
  { q: 'What’s the catch with the subdomain?', a: 'Your blog lives at blog.yourdomain.com rather than yourdomain.com/blog. A minor SEO trade-off that lets grove handle the infra invisibly. Embed snippets let you surface posts on your main site too.' },
  { q: 'How fast is the first post?', a: 'Verification takes about two minutes. Provisioning and voice profiling run in the background; your first draft is usually ready within minutes.' },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {ITEMS.map((it, i) => (
        <div key={i} className={`faq-item ${open === i ? 'on' : ''}`}>
          <button className="faq-q" onClick={() => setOpen(open === i ? null : i)}>
            {it.q}
            <span className="pm" />
          </button>
          <div className="faq-a"><div className="faq-a-in">{it.a}</div></div>
        </div>
      ))}
    </div>
  );
}
