import { describe, it, expect } from 'vitest';
import { describeOutputShape, textFromReplicateOutput } from '../lib/llm';

describe('textFromReplicateOutput', () => {
  it('joins streamed string chunks — the workhorse shape that always worked', () => {
    expect(textFromReplicateOutput(['{"a":', '1}'])).toBe('{"a":1}');
  });

  it('reads a plain string', () => {
    expect(textFromReplicateOutput('{"a":1}')).toBe('{"a":1}');
  });

  it('reads Anthropic message content — the shape that caused the outage', () => {
    // anthropic/claude-opus-4.7 returns an OBJECT. String(object) is
    // "[object Object]", which is non-empty, so it passed the old guard,
    // llmCall reported success, the fallback never fired, and every monthly
    // plan build died downstream in extractJson with the model already billed.
    const out = { content: [{ type: 'text', text: '{"goals":' }, { type: 'text', text: '[]}' }] };
    expect(textFromReplicateOutput(out)).toBe('{"goals":[]}');
  });

  it('reads single-field wrappers', () => {
    expect(textFromReplicateOutput({ text: 'hi' })).toBe('hi');
    expect(textFromReplicateOutput({ completion: 'hi' })).toBe('hi');
    expect(textFromReplicateOutput({ output: ['a', 'b'] })).toBe('ab');
  });

  it('returns null for shapes with no text, so the caller throws and the fallback engages', () => {
    // The critical assertion: these must be null, NOT "[object Object]".
    expect(textFromReplicateOutput({})).toBeNull();
    expect(textFromReplicateOutput({ id: 1, status: 'ok' })).toBeNull();
    expect(textFromReplicateOutput(null)).toBeNull();
    expect(textFromReplicateOutput(undefined)).toBeNull();
    expect(textFromReplicateOutput([])).toBeNull();
  });

  it('never yields the string "[object Object]" for any object shape', () => {
    for (const o of [{}, { a: 1 }, { content: [] }, { content: [{ type: 'image' }] }]) {
      expect(textFromReplicateOutput(o) ?? '').not.toContain('[object Object]');
    }
  });

  it('survives nested and mixed chunk arrays', () => {
    expect(textFromReplicateOutput([{ text: 'a' }, 'b', { type: 'text', text: 'c' }])).toBe('abc');
  });
});

describe('describeOutputShape', () => {
  it('summarises shape without leaking content into logs', () => {
    expect(describeOutputShape(null)).toBe('null');
    expect(describeOutputShape(undefined)).toBe('undefined');
    expect(describeOutputShape(['a', 'b'])).toBe('array(2)[string]');
    expect(describeOutputShape({ content: [], id: 1 })).toBe('object{content,id}');
    expect(describeOutputShape({})).toBe('object{no keys}');
    expect(describeOutputShape('x')).toBe('string');
  });
});
