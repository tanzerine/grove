'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftPhase } from '@/lib/pipeline/progress';

/** One generation this session started, followed until it lands. */
export type Run = {
  id: string;
  topic: string;         // what the author asked for
  title: string | null;  // what grove titled it, once it has a title
  phase: DraftPhase;
  label: string;
  stalled: boolean;      // in flight, but the run has gone quiet
  hasDraft: boolean;
};

/** Phases where the pipeline is still working on the article. */
export const WORKING: DraftPhase[] = ['queued', 'working'];

/** How often a live run is asked where it got to. */
const POLL_MS = 3000;

/**
 * The drafts grove is writing for the author right now.
 *
 * This lives above the editor on purpose: loading a finished draft remounts the
 * editor (and with it the rail), so run state kept inside the rail would vanish
 * at the exact moment it's meant to say "here's the article you asked for".
 *
 * `onReady` fires once per run, the first time it has words worth showing.
 */
export function usePipelineRuns(onReady: (id: string) => void) {
  const [runs, setRuns] = useState<Run[]>([]);
  const liveIds = runs.filter((r) => WORKING.includes(r.phase)).map((r) => r.id).join(',');
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;
  // Latest callback, read from inside the interval — the effect must not restart
  // just because the caller re-rendered with a new closure.
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  // Runs already announced, so a draft the author moved on from isn't shoved
  // back in front of them on the next poll.
  const announced = useRef(new Set<string>());

  const add = useCallback((id: string, topic: string) => {
    setRuns((prev) => [
      { id, topic, title: null, phase: 'queued', label: 'Queued in the pipeline…', stalled: false, hasDraft: false },
      ...prev.filter((p) => p.id !== id),
    ]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Follow every in-flight run. Keyed on the live ids (not `runs`) so a poll's
  // own state update doesn't tear the interval down and restart it.
  useEffect(() => {
    if (!liveIds) return;
    let alive = true;
    const poll = async () => {
      const ids = liveRef.current ? liveRef.current.split(',') : [];
      const seen = await Promise.all(ids.map(async (id) => {
        try {
          const res = await fetch(`/api/posts/${id}`);
          if (!res.ok) return null;
          const j = await res.json();
          return {
            id, phase: j.phase as DraftPhase, label: String(j.label ?? ''),
            title: j.title ?? null, stalled: !!j.stalled, hasDraft: !!j.hasDraft,
          };
        } catch { return null; }   // a dropped poll is not an error worth showing
      }));
      if (!alive) return;
      setRuns((prev) => prev.map((r) => {
        const u = seen.find((s) => s && s.id === r.id);
        return u ? { ...r, ...u } : r;
      }));
      for (const s of seen) {
        if (!s || s.phase !== 'ready' || !s.hasDraft) continue;
        if (announced.current.has(s.id)) continue;
        announced.current.add(s.id);
        readyRef.current(s.id);
      }
    };
    const t = setInterval(poll, POLL_MS);
    poll();
    return () => { alive = false; clearInterval(t); };
  }, [liveIds]);

  return { runs, add, dismiss };
}
