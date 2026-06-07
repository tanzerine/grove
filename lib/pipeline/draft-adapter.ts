/**
 * Bridges the writer's output shape to the manager's input shape.
 *
 * This exists because of a real production bug: generate.ts passed the raw
 * WriterOutput (which has `blog_post`) where the manager expected `body_md`,
 * so the manager threw on every post and the quality gate silently never ran.
 * Centralizing + testing the mapping prevents that class of regression.
 */
import type { WriterOutput } from './writer';

export type ManagerDraft = { body_md: string; meta_title: string; meta_description: string };

export function toManagerDraft(w: WriterOutput): ManagerDraft {
  return {
    body_md: w.blog_post,
    meta_title: w.meta_title,
    meta_description: w.meta_description,
  };
}
