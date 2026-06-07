import { describe, it, expect } from 'vitest';
import { toManagerDraft } from '../lib/pipeline/draft-adapter';

// Guards the production bug where generate.ts handed the manager a WriterOutput
// (blog_post) but it expected body_md, so the gate crashed on every post.
describe('toManagerDraft', () => {
  it('maps blog_post → body_md so the manager actually receives content', () => {
    const writer = {
      blog_post: 'THE ARTICLE BODY',
      meta_title: 'Title',
      meta_description: 'Desc',
      sources_provided: [],
    };
    const d = toManagerDraft(writer as any);
    expect(d.body_md).toBe('THE ARTICLE BODY');
    expect(d.meta_title).toBe('Title');
    expect(d.meta_description).toBe('Desc');
    // the manager must never receive an undefined body
    expect(d.body_md).toBeTypeOf('string');
    expect(d.body_md.length).toBeGreaterThan(0);
  });
});
