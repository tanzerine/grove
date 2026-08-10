/**
 * Prospect screening — and above all the ASYMMETRY.
 *
 * The tests that matter here are not "does a good post score well". They're the
 * ones pinning that a blocker beats a score: this machine's output goes into a
 * stranger's private inbox, and the expensive failure is never a missed
 * prospect, it's a pitch sent to someone who said don't, or who sells the same
 * thing, or who wrote three months ago and has moved on.
 */
import { describe, it, expect } from 'vitest';
import {
  screenPost,
  rankProspects,
  sentenceAround,
  tierAtLeast,
  type RedditPost,
} from '../lib/outreach/screen';

const NOW = new Date('2026-08-10T12:00:00Z');
const HOURS_AGO = (h: number) => Math.floor(NOW.getTime() / 1000) - h * 3600;

function post(over: Partial<RedditPost> = {}): RedditPost {
  return {
    id: over.id ?? 'abc123',
    subreddit: 'SaaS',
    author: 'someone',
    title: 'A title',
    selftext: '',
    permalink: 'https://www.reddit.com/r/SaaS/comments/abc123/x/',
    createdUtc: HOURS_AGO(12),
    score: 20,
    numComments: 8,
    ...over,
  };
}

/** A realistic strong prospect: owns a product, can't sustain the writing. */
const GOOD = post({
  title: 'I know I should be blogging but I have no time to write',
  selftext:
    "Solo founder here. My SaaS has been live for eight months and I don't have time to write blog posts — " +
    'every week it gets pushed to Friday and then it gets pushed to next week. I know organic search is how ' +
    'the products I admire got going, but sitting down to write a 1,500 word article is the last thing I want ' +
    "to do after support and shipping. Has anyone actually made this work as a one person team? I'm not going " +
    'to hire a content person at this stage.',
});

describe('finding the problem', () => {
  it('scores a solo founder who cannot sustain writing as a strong fit', () => {
    const s = screenPost(GOOD, NOW);
    expect(s.tier).toBe('strong');
    expect(s.pain).toBe('no_time');
    expect(s.blockers.filter((b) => b.hard)).toHaveLength(0);
  });

  it('quotes the author back, because that is what the DM has to open with', () => {
    const s = screenPost(GOOD, NOW);
    const quote = s.evidence.find((e) => e.key === 'no_time')?.quote ?? '';
    // Not a label, not a regex fragment — a whole sentence a human could paste.
    expect(quote).toBe(
      "My SaaS has been live for eight months and I don't have time to write blog posts — " +
        'every week it gets pushed to Friday and then it gets pushed to next week.',
    );
    expect(quote.split(/\s+/).length).toBeGreaterThan(5);
  });

  it('quotes the body over the title — a headline read back says you skimmed', () => {
    const s = screenPost(
      post({
        title: 'I have no time to write',
        selftext: 'Running my own SaaS. I have no time to write anything longer than a changelog these days.',
      }),
      NOW,
    );
    expect(s.evidence[0].quote).toMatch(/longer than a changelog/);
  });

  it('still falls back to the title when the body does not carry the phrase', () => {
    const s = screenPost(
      post({ title: 'My site gets zero traffic', selftext: 'Been at this a while and I am out of ideas entirely.' }),
      NOW,
    );
    expect(s.evidence[0].quote).toBe('My site gets zero traffic');
  });

  it('separates having the problem from being reachable by this product', () => {
    // Same complaint, but nothing of their own to publish to: no site, no
    // product, no domain. Grove has nowhere to put an article.
    const noDomain = post({
      title: 'no time to write content for my Etsy listings',
      selftext:
        "I don't have time to write and everything I sell goes through the marketplace. " +
        "Content is a chore I keep putting off and I've basically given up on the blog idea.",
    });
    expect(screenPost(noDomain, NOW).fit).toBeLessThan(screenPost(GOOD, NOW).fit);
  });

  it('reads the pain, not the topic — the angle drives which DM gets written', () => {
    const cases: [string, string][] = [
      ['I wrote 4 blog posts last year and then stopped. My blog has been dead since.', 'quit_content'],
      ['We keep building instead of marketing. Distribution is the thing we all avoid.', 'distribution'],
      ['Six months of SEO on my site and nothing. Is SEO even worth it anymore?', 'seo_slow'],
      ['Launched my SaaS three weeks ago and got crickets. Zero traffic.', 'no_traffic'],
      ['Agency quoted me $4,000/month for content. I cannot afford an agency.', 'agency_cost'],
    ];
    for (const [text, expected] of cases) {
      expect(screenPost(post({ title: text, selftext: text }), NOW).pain).toBe(expected);
    }
  });
});

describe('reasons not to send', () => {
  it('refuses anyone who said not to pitch them, however well they scored', () => {
    const s = screenPost(
      post({
        title: 'My SaaS has zero traffic and I have no time to write. No DMs please.',
        selftext:
          'Solo founder, my site gets no traffic, I gave up on the blog months ago and I have no time to write. ' +
          'Looking for advice only — no DMs, no pitches.',
      }),
      NOW,
    );
    // It scored well on every axis. That must not matter.
    expect(s.fit).toBeGreaterThan(60);
    expect(s.tier).toBe('skip');
    expect(s.blockers.some((b) => b.kind === 'no_dm' && b.hard)).toBe(true);
  });

  it('refuses someone building the same thing', () => {
    const s = screenPost(
      post({
        title: 'I built an AI SEO writer for my own site — no traffic yet',
        selftext: 'I built an AI SEO content tool because I had no time to write. My site gets zero traffic so far.',
      }),
      NOW,
    );
    expect(s.tier).toBe('skip');
    expect(s.blockers.some((b) => b.kind === 'competitor')).toBe(true);
  });

  it('refuses people who sell SEO themselves', () => {
    const s = screenPost(
      post({
        title: 'SEO for SaaS — DM me for rates',
        selftext: 'I do SEO for clients. My agency helps SaaS companies with content. DM me for rates.',
      }),
      NOW,
    );
    expect(s.tier).toBe('skip');
    expect(s.blockers.some((b) => b.kind === 'for_hire')).toBe(true);
  });

  it('refuses someone who already told you what they think of AI writing', () => {
    const s = screenPost(
      post({
        title: 'My site has no traffic but I would never use AI to write',
        selftext: "My saas gets no traffic. I don't have time to write, but I'd never use AI to write for me — it's slop.",
      }),
      NOW,
    );
    expect(s.tier).toBe('skip');
    expect(s.blockers.some((b) => b.kind === 'anti_ai')).toBe(true);
  });

  it('is NOT tripped by someone merely asking whether AI content ranks', () => {
    // This person has an objection, not a position — they're a prospect.
    const s = screenPost(
      post({
        title: 'Does Google penalize AI written content?',
        selftext:
          "I run my own SaaS and I have no time to write blog posts. Thinking about using AI but I don't know " +
          'if Google penalizes it. Anyone have data? My blog has been dead for six months.',
      }),
      NOW,
    );
    expect(s.blockers.some((b) => b.kind === 'anti_ai')).toBe(false);
    expect(s.tier).not.toBe('skip');
  });

  it('has no one to write to when the account is gone', () => {
    const s = screenPost({ ...GOOD, author: '[deleted]' }, NOW);
    expect(s.tier).toBe('skip');
    expect(s.blockers.some((b) => b.kind === 'deleted' && b.hard)).toBe(true);
  });
});

describe('post shape', () => {
  it('penalises a post too old to reference naturally, without hard-blocking it', () => {
    const old = screenPost({ ...GOOD, createdUtc: HOURS_AGO(24 * 40) }, NOW);
    const fresh = screenPost(GOOD, NOW);
    expect(old.fit).toBeLessThan(fresh.fit);
    expect(old.blockers.some((b) => b.kind === 'stale' && !b.hard)).toBe(true);
  });

  it('flags a post with nothing in it to personalise from', () => {
    const s = screenPost(post({ title: 'no traffic on my saas, any tips?', selftext: '' }), NOW);
    expect(s.blockers.some((b) => b.kind === 'thin')).toBe(true);
  });

  it('flags a thread already drowning in replies', () => {
    const s = screenPost({ ...GOOD, numComments: 800 }, NOW);
    expect(s.blockers.some((b) => b.kind === 'crowded')).toBe(true);
  });

  it('explains its arithmetic so a surprising score can be argued with', () => {
    const s = screenPost(GOOD, NOW);
    expect(s.reasons.length).toBeGreaterThan(2);
    expect(s.reasons.join(' ')).toMatch(/\+\d+/);
  });
});

describe('ranking a batch', () => {
  const weak = post({ id: 'weak', author: 'weakling', title: 'hello', selftext: 'hi' });
  const strong = { ...GOOD, id: 'strong', author: 'founder1' };

  it('drops anyone already in the outreach list — the whole point of dedupe', () => {
    const out = rankProspects([strong], { now: NOW, excludeAuthors: ['FOUNDER1'] });
    expect(out).toHaveLength(0);
  });

  it('drops duplicate sightings of the same post across queries', () => {
    const out = rankProspects([strong, { ...strong }], { now: NOW });
    expect(out).toHaveLength(1);
  });

  it('returns best first and leaves out what is not worth reading', () => {
    const out = rankProspects([weak, strong], { now: NOW });
    expect(out.map((p) => p.post.id)).toEqual(['strong']);
  });

  it('can be narrowed to strong fits only', () => {
    const borderline = post({
      id: 'mid', author: 'mid',
      title: 'my site gets no traffic',
      selftext: 'I launched my site a while back and it gets no traffic at all. Not sure what to do next, honestly.',
    });
    const all = rankProspects([borderline, strong], { now: NOW });
    const strict = rankProspects([borderline, strong], { now: NOW, minTier: 'strong' });
    expect(all.length).toBeGreaterThan(strict.length);
  });
});

describe('sentenceAround', () => {
  it('widens a match out to its own sentence', () => {
    const text = 'First thing. I have no time to write anything. Third thing.';
    expect(sentenceAround(text, text.indexOf('no time'))).toBe('I have no time to write anything.');
  });

  it('truncates rather than quoting a wall of text', () => {
    const long = `${'a'.repeat(400)} needle`;
    const q = sentenceAround(long, long.indexOf('needle'), 60);
    expect(q.length).toBeLessThanOrEqual(60);
    expect(q.endsWith('…')).toBe(true);
  });
});

describe('tierAtLeast', () => {
  it('orders the tiers', () => {
    expect(tierAtLeast('strong', 'worth_a_look')).toBe(true);
    expect(tierAtLeast('worth_a_look', 'strong')).toBe(false);
    expect(tierAtLeast('skip', 'worth_a_look')).toBe(false);
  });
});
