'use client';
import { useCallback, useRef, useState } from 'react';
import RichEditor from '../posts/[id]/RichEditor';
import StartDraft from './StartDraft';
import { usePipelineRuns } from './use-pipeline-runs';

/** The draft currently on the canvas. null = the blank page you arrived on. */
type Loaded = {
  id: string;
  title: string;
  body_md: string;
  meta_title: string;
  meta_description: string;
  scheduled_at: string | null;
};

/**
 * The Write page's canvas plus its assist rail, and the one thing that has to
 * be client state: WHICH draft the editor is holding.
 *
 * "grove writes it" used to leave the page entirely. Now the article grove wrote
 * loads into this same editor — the author stays where they were, and the draft
 * they asked for appears in front of them. The blank page is just the state
 * where nothing is loaded yet.
 */
export default function WriteSurface({ domainId, hostname }: { domainId: string; hostname: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dirty, setDirty] = useState(false);      // unsaved words on the canvas
  const [opening, setOpening] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  // `openDraft` is defined below but the runs hook needs it now; the ref keeps
  // the wiring honest without reordering the two.
  const openRef = useRef<(id: string, auto?: boolean) => void>(() => {});
  const { runs, add, dismiss } = usePipelineRuns((id) => openRef.current(id, true));

  /**
   * Put a finished draft on the canvas.
   *
   * `auto` marks the hands-off case — a generation the author started finished
   * while they watched — which only ever swaps a canvas that would lose nothing.
   * An explicit click asks first instead of refusing, because by then the author
   * has said which article they want to look at.
   */
  const openDraft = useCallback(async (id: string, auto = false) => {
    if (opening) return;
    if (loaded?.id === id) return;
    if (dirty || (auto && loaded)) {
      if (auto) return;   // never interrupt someone mid-sentence
      if (!confirm('Put grove’s draft on the page? Unsaved words here will be lost.')) return;
    }
    setOpening(id); setOpenErr(null);
    try {
      const res = await fetch(`/api/posts/${id}?content=1`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.post) {
        setOpenErr('Could not open that draft — open it from your pipeline instead.');
        return;
      }
      setLoaded(j.post as Loaded);
      setDirty(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setOpenErr('Could not open that draft — check your connection and try again.');
    } finally {
      setOpening(null);
    }
  }, [dirty, loaded, opening]);
  openRef.current = openDraft;

  /** Back to a blank page, keeping the loaded draft safe in the pipeline. */
  const newBlank = useCallback(() => {
    if (dirty && !confirm('Start a blank page? Unsaved words here will be lost.')) return;
    setLoaded(null); setDirty(false); setOpenErr(null);
  }, [dirty]);

  return (
    <RichEditor
      // Remounting per draft is what makes the swap clean: tiptap builds its doc
      // from `initialBody`, and the assist feed / save baselines belong to the
      // post they were opened against.
      key={loaded?.id ?? 'blank'}
      postId={loaded?.id ?? null}
      domainId={domainId}
      initialBody={loaded?.body_md ?? ''}
      initialTitle={loaded?.title ?? ''}
      initialMetaTitle={loaded?.meta_title ?? ''}
      initialMetaDesc={loaded?.meta_description ?? ''}
      initialScheduledAt={loaded?.scheduled_at ?? null}
      canEdit
      // A blank page opens in edit mode with the cursor waiting; a written
      // article opens as something to read, one click from editing.
      autoEdit={!loaded?.body_md?.trim()}
      onDirtyChange={setDirty}
      railExtra={
        <StartDraft
          domainId={domainId}
          hostname={hostname}
          runs={runs}
          onQueued={add}
          onDismissRun={dismiss}
          onOpenDraft={openDraft}
          activeDraftId={loaded?.id ?? null}
          openingId={opening}
          openError={openErr}
          onBlankPage={loaded ? newBlank : undefined}
        />
      }
    />
  );
}
