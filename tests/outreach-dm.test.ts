/**
 * The DM draft.
 *
 * Two things are load-bearing and everything else is taste:
 *
 *  1. The message must contain the author's own words, or say loudly that it
 *     doesn't. A cold DM that could have been sent to anyone is spam even when
 *     the product fits.
 *  2. The claims below the opener must be BYTE-IDENTICAL every time. The honest
 *     caveat ("it won't get you a paying customer this month") is the only line
 *     that proves this isn't a numbers game; if a variant path can soften it,
 *     it stops being true of every message that went out.
 */
import { describe, it, expect } from 'vitest';
import {
  composeDm, wordCount, lengthWarnings, isLengthWarning, DM_MAX_WORDS, type CouponOffer,
} from '../lib/outreach/dm';
import { cleanOpener } from '../lib/outreach/personalize';
import { screenPost, type RedditPost } from '../lib/outreach/screen';

const NOW = new Date('2026-08-10T12:00:00Z');
const COUPON: CouponOffer = {
  code: 'GROVEBETA', postsQuota: 12, days: 30, url: 'https://trygroveai.com/signup',
};

function prospectFrom(over: Partial<RedditPost>) {
  const post: RedditPost = {
    id: 'p1', subreddit: 'SaaS', author: 'founder1',
    title: over.title ?? 'title', selftext: over.selftext ?? '',
    permalink: 'https://www.reddit.com/r/SaaS/comments/p1/x/',
    createdUtc: Math.floor(NOW.getTime() / 1000) - 3600,
    score: 12, numComments: 5, ...over,
  };
  return { post, screen: screenPost(post, NOW) };
}

const REAL = prospectFrom({
  title: 'I have no time to write blog posts',
  selftext:
    'Solo founder, my SaaS is eight months old. I have no time to write blog posts and it keeps sliding to next week. ' +
    'I know search is how this is supposed to work but I cannot sustain it alongside support and shipping.',
});

describe('the draft is about them', () => {
  it('opens with the author’s own sentence', () => {
    const dm = composeDm(REAL, { senderName: 'Ty', coupon: COUPON });
    expect(dm.body.split('\n\n')[0]).toMatch(/no time to write blog posts/i);
    expect(dm.body).toMatch(/r\/SaaS/);
  });

  it('says so when there is nothing quotable, instead of quietly sending a mail merge', () => {
    const thin = prospectFrom({ title: 'zero traffic', selftext: '' });
    const dm = composeDm(thin, { senderName: 'Ty', coupon: COUPON });
    expect(dm.warnings.some((w) => /write the first sentence yourself/i.test(w))).toBe(true);
  });

  it('never quotes a fit signal back at them — that proves you skimmed', () => {
    // "my saas" matched own_site but no pain did; quoting it would read as a
    // keyword hit, so the composer must fall back to the title and warn.
    const fitOnly = prospectFrom({
      title: 'Introducing my SaaS for dog groomers',
      selftext: 'My SaaS launched today on webflow. Would love thoughts on the pricing page and the onboarding flow.',
    });
    const dm = composeDm(fitOnly, { senderName: 'Ty', coupon: COUPON });
    expect(dm.warnings.some((w) => /write the first sentence yourself/i.test(w))).toBe(true);
  });

  it('changes the angle with the pain, so two prospects don’t get one letter', () => {
    const quit = prospectFrom({
      title: 'I wrote 4 posts and then stopped',
      selftext: 'I wrote 4 blog posts and then stopped. My blog has been dead for a year now on my own site.',
    });
    const a = composeDm(REAL, { senderName: 'Ty', coupon: COUPON });
    const b = composeDm(quit, { senderName: 'Ty', coupon: COUPON });
    expect(a.angle).not.toBe(b.angle);
    expect(a.subject).not.toBe(b.subject);
    expect(a.body.split('\n\n')[1]).not.toBe(b.body.split('\n\n')[1]);
  });

  it('always has a subject — it is the entire preview the reader sees', () => {
    for (const p of [REAL, prospectFrom({ title: 'x', selftext: '' })]) {
      const dm = composeDm(p, { senderName: 'Ty', coupon: COUPON });
      expect(dm.subject.trim().length).toBeGreaterThan(5);
    }
  });
});

describe('the claims are fixed', () => {
  it('keeps the honest caveat verbatim in every variant', () => {
    const prospects = [
      REAL,
      prospectFrom({ title: 'crickets after launch', selftext: 'Launched my app and got crickets. Zero traffic on my site so far, nothing at all.' }),
      prospectFrom({ title: 'agency wants $4000/mo', selftext: 'The agency quoted me $4,000/month for content on my site. I cannot afford an agency like that.' }),
    ];
    for (const p of prospects) {
      const dm = composeDm(p, { senderName: 'Ty', coupon: COUPON });
      expect(dm.body).toContain("it won't get you a paying customer this month");
      expect(dm.body).toContain('SEO doesn\'t move that fast');
    }
  });

  it('states what the coupon actually grants, from the coupon row', () => {
    const dm = composeDm(REAL, { senderName: 'Ty', coupon: { ...COUPON, postsQuota: 4, days: 14 } });
    expect(dm.body).toContain('GROVEBETA');
    expect(dm.body).toContain('4 posts a month for 14 days');
    expect(dm.body).toContain('https://trygroveai.com/signup');
  });

  it('warns when there is no code, because then the only ask is "reply to me"', () => {
    const dm = composeDm(REAL, { senderName: 'Ty', coupon: null });
    expect(dm.warnings.some((w) => /no coupon attached/i.test(w))).toBe(true);
    expect(dm.body).not.toMatch(/paste code/i);
  });

  it('signs off as the sender', () => {
    expect(composeDm(REAL, { senderName: 'Ty', coupon: COUPON }).body.trimEnd().endsWith('— Ty')).toBe(true);
  });
});

describe('warnings before the copy button', () => {
  it('shouts about a hard blocker at the last moment it can', () => {
    const blocked = prospectFrom({
      title: 'no time to write, and no DMs please',
      selftext: 'My SaaS gets no traffic and I have no time to write. Advice welcome but no DMs please.',
    });
    const dm = composeDm(blocked, { senderName: 'Ty', coupon: COUPON });
    expect(dm.warnings.some((w) => w.startsWith('DO NOT SEND'))).toBe(true);
  });

  it('always reminds you the subreddit has its own rules', () => {
    const dm = composeDm(REAL, { senderName: 'Ty', coupon: COUPON });
    expect(dm.warnings.some((w) => /rules on DMing/i.test(w))).toBe(true);
  });

  it('stays inside the length a cold DM can carry, on every angle', () => {
    // Each of these carries a deliberately long quotable sentence, so this is
    // the template at its worst case. If DM_MAX_WORDS ever fires on an ordinary
    // draft the warning becomes noise and stops being read at all.
    const worstCase = [
      REAL,
      prospectFrom({ title: 'a', selftext: 'I run my own SaaS and I wrote four blog posts in a burst last spring and then I stopped completely and the blog has been dead ever since then.' }),
      prospectFrom({ title: 'b', selftext: 'On my own site we keep building instead of marketing every single quarter because shipping features is the comfortable thing and distribution never is.' }),
      prospectFrom({ title: 'c', selftext: 'Eight full months of SEO on my site and honestly is SEO even worth it any more for a product as small and as niche as the one I am running.' }),
      prospectFrom({ title: 'd', selftext: 'I launched my SaaS product back in the spring after a year of work and got absolutely crickets, zero traffic and no signups at all since.' }),
      prospectFrom({ title: 'e', selftext: 'The content agency I spoke to last week quoted me $4,500/month for blog content and I simply cannot afford an agency at that kind of price.' }),
    ];
    for (const p of worstCase) {
      const dm = composeDm(p, { senderName: 'Ty', coupon: COUPON });
      expect({ angle: dm.angle, over: dm.words > DM_MAX_WORDS }).toEqual({ angle: dm.angle, over: false });
      expect(wordCount(dm.body)).toBe(dm.words);
    }
    // …and they really did exercise different bridges, not one angle six times.
    expect(new Set(worstCase.map((p) => composeDm(p, { senderName: 'Ty', coupon: COUPON }).angle)).size)
      .toBeGreaterThan(4);
  });

  it('does not double-punctuate when the quoted sentence ends in a full stop', () => {
    const dm = composeDm(REAL, { senderName: 'Ty', coupon: COUPON });
    expect(dm.body).not.toMatch(/[.,;:]"/);
  });

  it('re-measures length after a model rewrites the opener', () => {
    // The deterministic warning was computed against the old first paragraph.
    // If the model hands back a paragraph instead of a sentence, the warning
    // has to fire on the NEW total — this is the case it exists for.
    const short = lengthWarnings(40);
    const long = lengthWarnings(DM_MAX_WORDS + 30);
    expect(short[0]).toMatch(/too thin/);
    expect(long[0]).toMatch(/reads as a pitch/);
    expect(lengthWarnings(120)).toEqual([]);
    // Both are recognised as length warnings, so the swap can drop exactly them.
    for (const w of [...short, ...long]) expect(isLengthWarning(w)).toBe(true);
    expect(isLengthWarning('Check r/SaaS’s rules on DMing members before you send.')).toBe(false);
  });
});

describe('cleanOpener — what the model is allowed to hand back', () => {
  it('accepts a short, specific paragraph', () => {
    expect(cleanOpener('You said the blog "keeps sliding to next week". That line is the whole problem.'))
      .toMatch(/keeps sliding/);
  });

  it('unwraps the ways a model dresses up an answer', () => {
    expect(cleanOpener('Here is the opener: You said the blog keeps sliding.')).toBe('You said the blog keeps sliding.');
    expect(cleanOpener('```\nYou said the blog keeps sliding.\n```')).toBe('You said the blog keeps sliding.');
    expect(cleanOpener('"You said the blog keeps sliding."')).toBe('You said the blog keeps sliding.');
  });

  it('takes only the first paragraph, so the model cannot rewrite the claims', () => {
    const out = cleanOpener('Line one about their post.\n\nAnd here is my pitch for Grove, free beta!');
    expect(out).toBe('Line one about their post.');
  });

  it('rejects an opener that has wandered into the pitch', () => {
    expect(cleanOpener('I am building Grove and it writes your blog for you.')).toBeNull();
    expect(cleanOpener('Check out https://trygroveai.com for a free beta.')).toBeNull();
    expect(cleanOpener('Free beta, no card needed, code ABCDEF12.')).toBeNull();
  });

  it('rejects an opener that is really an essay', () => {
    expect(cleanOpener('word '.repeat(60))).toBeNull();
    expect(cleanOpener('   ')).toBeNull();
  });
});
