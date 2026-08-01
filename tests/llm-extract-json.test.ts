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

describe('truncated output (max_tokens guillotine)', () => {
  // THE 2026-08-01 OUTAGE, in miniature. The model wrote a valid plan and was
  // cut off mid-calendar; V8 reports the unterminated array as "Expected ','
  // or ']' after array element", which reads like malformed output but means
  // "there was more". Everything already written must survive.
  const truncatedPlan =
    '{"month":"2026-08","goals":[{"id":"page-one","title":"Push near-winners to page 1"}],' +
    '"publishing_plan":[{"id":"a","topic":"First article"},{"id":"b","topic":"Second article"},' +
    '{"id":"c","topic":"Third article that the model never finished writ';

  it('recovers the complete part of a plan cut off mid-array', () => {
    const parsed = extractJson<any>(truncatedPlan);
    expect(parsed.month).toBe('2026-08');
    expect(parsed.goals).toHaveLength(1);
    // The two finished slots are kept; the half-written third is dropped, not guessed.
    expect(parsed.publishing_plan.map((s: any) => s.id)).toEqual(['a', 'b']);
  });

  it('recovers when the cut lands inside the very first slot', () => {
    const parsed = extractJson<any>(
      '{"month":"2026-08","kpis":[{"id":"k1","metric":"views"}],"publishing_plan":[{"id":"a","topic":"unfinis',
    );
    expect(parsed.kpis).toHaveLength(1);
    // Nothing complete in the calendar — buildStrategy refuses to persist this
    // rather than writing a month that reads as covered but publishes nothing.
    expect(parsed.publishing_plan ?? []).toHaveLength(0);
  });

  it('survives a cut inside a string containing braces and escapes', () => {
    const parsed = extractJson<any>(
      '{"a":[{"note":"uses {curly} and \\"quoted\\" text"},{"note":"cut here {[ \\" ',
    );
    expect(parsed.a).toEqual([{ note: 'uses {curly} and "quoted" text' }]);
  });

  it('leaves valid JSON completely alone', () => {
    const whole = { month: '2026-08', publishing_plan: [{ id: 'a' }, { id: 'b' }] };
    expect(extractJson(JSON.stringify(whole))).toEqual(whole);
  });

  it('still throws when there is nothing complete to salvage', () => {
    expect(() => extractJson('{"publishing_plan":[{"id":"only-a-fragm')).toThrow();
  });
});
