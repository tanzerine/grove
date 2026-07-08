import { describe, it, expect } from 'vitest';
import { extractJson } from '../lib/llm';

describe('extractJson', () => {
  it('parses a plain JSON object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('unwraps a fully fenced response', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('slices JSON out of surrounding chatter', () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"a": 1}\n```\nHope that helps.')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": 1}')).toEqual({ a: 1 });
  });

  // The stress run found the always-on "repairs" corrupting VALID output.
  it('preserves typographic quotes inside string values (valid JSON)', () => {
    const valid = '{"note": "the draft says “ship fast” which is vague", "score": 80}';
    expect(extractJson(valid)).toEqual({ note: 'the draft says “ship fast” which is vague', score: 80 });
  });

  it('preserves ``` code fences inside string values', () => {
    const resp = JSON.stringify({ body: 'intro\n```js\nconsole.log(1)\n```\noutro', ok: true });
    expect(extractJson(resp)).toEqual({ body: 'intro\n```js\nconsole.log(1)\n```\noutro', ok: true });
  });

  it('a fenced response whose values also contain fences survives', () => {
    const inner = JSON.stringify({ body: 'a\n```py\nx = 1\n```\nb' });
    expect(extractJson('```json\n' + inner + '\n```')).toEqual({ body: 'a\n```py\nx = 1\n```\nb' });
  });

  // Sloppy-output repairs must still fire when the clean parse fails.
  it('repairs trailing commas', () => {
    expect(extractJson('{"a": 1, "b": [1, 2,], }')).toEqual({ a: 1, b: [1, 2] });
  });

  it('repairs literal control characters inside strings', () => {
    expect(extractJson('{"a": "line1\nline2"}')).toEqual({ a: 'line1\nline2' });
  });

  it('repairs curly quotes used as delimiters (last resort)', () => {
    expect(extractJson('{“a”: 1}')).toEqual({ a: 1 });
  });

  it('throws on empty and brace-less input', () => {
    expect(() => extractJson('')).toThrow(/empty/);
    expect(() => extractJson('no json here')).toThrow(/no JSON braces/);
  });
});
