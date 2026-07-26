import { describe, it, expect } from 'vitest';
import { parseSocialOutput } from '../lib/pipeline/writer';

// Guards the production bug where the adapter's strict ---X--- delimiter
// regex didn't match the model's actual output, so "Write social posts"
// saved { x: '', linkedin: '' } and reported ok:true.
describe('parseSocialOutput', () => {
  it('parses plain JSON output', () => {
    const r = parseSocialOutput('{"x":"1. hook","linkedin":"story"}');
    expect(r).toEqual({ x: '1. hook', linkedin: 'story' });
  });

  it('parses JSON wrapped in a markdown fence', () => {
    const r = parseSocialOutput('```json\n{"x":"1. hook","linkedin":"li"}\n```');
    expect(r.x).toBe('1. hook');
    expect(r.linkedin).toBe('li');
  });

  it('parses the legacy delimiter format', () => {
    const text = '---X---\n1. hook\n2. point\n---LINKEDIN---\nstory here';
    const r = parseSocialOutput(text);
    expect(r.x).toBe('1. hook\n2. point');
    expect(r.linkedin).toBe('story here');
  });

  it('tolerates decorated / lower-case delimiters', () => {
    const text = '**---x---**\n1. hook\n## --- LinkedIn ---\nstory';
    const r = parseSocialOutput(text);
    expect(r.x).toBe('1. hook');
    expect(r.linkedin).toBe('story');
  });

  it('accepts partial output (one channel missing)', () => {
    const r = parseSocialOutput('{"x":"1. hook"}');
    expect(r.x).toBe('1. hook');
    expect(r.linkedin).toBe('');
  });

  it('coerces non-string channel values to empty instead of crashing', () => {
    const r = parseSocialOutput('{"x":"1. hook","linkedin":{"post":"nested"}}');
    expect(r.x).toBe('1. hook');
    expect(r.linkedin).toBe('');
  });

  it('THROWS when every channel is empty — never persist silent blanks', () => {
    expect(() => parseSocialOutput('Sure! Here are your social posts for the article.'))
      .toThrow(/no channel copy/);
    expect(() => parseSocialOutput('{"x":"","linkedin":""}'))
      .toThrow(/no channel copy/);
  });
});
