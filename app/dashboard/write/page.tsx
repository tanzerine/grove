import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import RichEditor from '../posts/[id]/RichEditor';
import StartDraft from './StartDraft';
import { DashHeader } from '../gv-chrome';

export default async function WritePage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  return (
    <>
      <DashHeader title="Write" subtitle="a blank page — write it yourself, or start from Idea studio / SEO set on the right. Generate images from the toolbar, then pick when it publishes." />
      <div className="gv-body" style={{ maxWidth: 1440 }}>
        {domain ? (
          <RichEditor
            postId={null}
            domainId={domain.id}
            initialBody=""
            initialTitle=""
            initialMetaTitle=""
            initialMetaDesc=""
            canEdit
            autoEdit
            railExtra={<StartDraft domainId={domain.id} hostname={domain.hostname} />}
          />
        ) : (
          <p className="lede" style={{ marginTop: 24 }}>Add a domain first to start writing.</p>
        )}
      </div>
    </>
  );
}
