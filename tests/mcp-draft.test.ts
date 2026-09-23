import { describe, it, expect } from 'vitest';
import { normalizeDraft, splitFrontmatter } from '@/lib/mcp/draft';

/**
 * An agent's draft usually arrives as a file. What must never happen is the
 * file shape reaching body_md verbatim: frontmatter renders as a paragraph of
 * `title: "…"` lines on the live article, and a second H1 ships a stale
 * headline above the real one.
 */
const BODY = 'Backlinks still count, but not the way most founders think.\n\n## Key takeaways\n\n- One.\n';

describe('splitFrontmatter', () => {
  it('reads flat key: value lines and strips quotes', () => {
    const { fields, body } = splitFrontmatter('---\ntitle: "Hello"\ndescription: \'A meta line\'\n---\nBody');
    expect(fields).toEqual({ title: 'Hello', description: 'A meta line' });
    expect(body).toBe('Body');
  });

  it('leaves a body without frontmatter alone — including a later horizontal rule', () => {
    const md = 'Intro\n\n---\n\nMore';
    expect(splitFrontmatter(md)).toEqual({ fields: {}, body: md });
  });
});

describe('normalizeDraft', () => {
  it('strips frontmatter and opens the body with the title as H1', () => {
    const d = normalizeDraft({ title: 'Why Backlinks Matter Less', body_md: `---\ntitle: x\ndescription: From frontmatter\n---\n\n${BODY}` });
    expect(d.body_md.startsWith('# Why Backlinks Matter Less\n\nBacklinks still count')).toBe(true);
    expect(d.body_md).not.toContain('title: x');
    expect(d.description).toBe('From frontmatter');
  });

  it('replaces an existing leading H1 instead of stacking a second', () => {
    const d = normalizeDraft({ title: 'New headline', body_md: `# Old headline\n\n${BODY}` });
    expect(d.body_md.match(/^# /gm)).toHaveLength(1);
    expect(d.body_md).toContain('# New headline');
    expect(d.body_md).not.toContain('Old headline');
  });

  it('keeps H2s and the rest of the body intact', () => {
    const d = normalizeDraft({ title: 'T', body_md: BODY });
    expect(d.body_md).toContain('## Key takeaways\n\n- One.');
  });

  it('prefers an explicit description over frontmatter, and caps it', () => {
    const d = normalizeDraft({ title: 'T', body_md: `---\ndescription: fm\n---\n${BODY}`, description: 'x'.repeat(400) });
    expect(d.description).toHaveLength(300);
    expect(normalizeDraft({ title: 'T', body_md: BODY }).description).toBeNull();
  });

  it('collapses whitespace in the title', () => {
    expect(normalizeDraft({ title: '  Two   spaces ', body_md: BODY }).title).toBe('Two spaces');
  });
});
