import { describe, it, expect } from 'vitest';
import { resumeState } from '../lib/pipeline/generate';

const DRAFT = 'x'.repeat(250); // > 200 chars — a usable draft

// resumeState decides which pipeline stages a retry can skip. It's the whole
// point of "retry fires from the stage that failed" — so it must never claim a
// draft is reusable unless the research context needed to gate it is also there.
describe('resumeState', () => {
  it('fresh post reuses nothing', () => {
    expect(resumeState({})).toEqual({ reuseResearch: false, reuseDraft: false });
    expect(resumeState({ research: null, body_md: null }))
      .toEqual({ reuseResearch: false, reuseDraft: false });
  });

  it('failed before research: research half-written (no context) is not reusable', () => {
    // brief present but no full context → an old/partial row → redo research
    const post = { research: { brief: { title: 't', format: 'guide' } }, body_md: null };
    expect(resumeState(post)).toEqual({ reuseResearch: false, reuseDraft: false });
  });

  it('failed at the writer: research is reusable, draft is not', () => {
    const post = {
      research: { brief: { title: 't', format: 'guide' }, context: { primary: [] } },
      body_md: null,
    };
    expect(resumeState(post)).toEqual({ reuseResearch: true, reuseDraft: false });
  });

  it('failed after the draft (e.g. persist): both research and draft are reusable', () => {
    const post = {
      research: { brief: { title: 't', format: 'guide' }, context: { primary: [] } },
      body_md: DRAFT,
    };
    expect(resumeState(post)).toEqual({ reuseResearch: true, reuseDraft: true });
  });

  it('never reuses a draft without its research context (manager/validator would break)', () => {
    // draft exists but context missing → can't safely gate it → re-run cleanly
    const post = { research: { brief: { title: 't' } }, body_md: DRAFT };
    expect(resumeState(post).reuseDraft).toBe(false);
  });

  it('treats a too-short draft as not a real draft', () => {
    const post = {
      research: { brief: { title: 't' }, context: { primary: [] } },
      body_md: 'too short',
    };
    expect(resumeState(post).reuseDraft).toBe(false);
  });
});

// A "rewrite from scratch" on a finished post used to reuse the persisted draft,
// re-score it and write the same words back — the button looked broken because
// nothing about the article changed. `fresh` is what separates the two intents.
describe('resumeState(post, fresh)', () => {
  const finished = {
    research: { brief: { title: 't', format: 'guide' }, context: { primary: [] } },
    body_md: DRAFT,
  };

  it('reuses nothing on a complete post when a fresh rewrite is asked for', () => {
    expect(resumeState(finished, true)).toEqual({ reuseResearch: false, reuseDraft: false });
  });

  it('still resumes that same post by default', () => {
    expect(resumeState(finished)).toEqual({ reuseResearch: true, reuseDraft: true });
    expect(resumeState(finished, false)).toEqual({ reuseResearch: true, reuseDraft: true });
  });

  it('is a no-op on a post with nothing to reuse', () => {
    expect(resumeState({}, true)).toEqual({ reuseResearch: false, reuseDraft: false });
  });
});
