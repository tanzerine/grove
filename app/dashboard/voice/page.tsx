import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import type { RepoKnowledge } from '@/lib/pipeline/repo-knowledge';
import CrawlButton from './CrawlButton';
import RepoConnect from './RepoConnect';
import { DashHeader } from '../gv-chrome';

export default async function Page() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const profile = (domain?.site_profile ?? {}) as any;
  const b = profile.business ?? {};
  const v = profile.voice ?? {};
  const meta = profile.meta ?? {};
  const hasProfile = !!b.name;
  const repoKb = (domain?.repo_knowledge ?? null) as RepoKnowledge | null;

  return (
    <>
      <DashHeader title="Brand voice" subtitle="the context grove writes from" />
      <div className="gv-body">
      {domain?.id && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <CrawlButton domainId={domain.id} hostname={domain.hostname} />
        </div>
      )}
      <p className="lede">
        Context grove uses for every article. The more accurate, the more on-brand the writing.
      </p>

      {!hasProfile && (
        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.24)', color: '#d8d2bf', padding: 18, borderRadius: 12, marginTop: 20 }}>
          <b>No profile yet.</b>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            Click <b>Crawl my site</b> above. It hits your homepage, /about, /pricing, /products, /services,
            and /contact, then extracts what you do, who you sell to, and your brand voice.
          </p>
        </div>
      )}

      {hasProfile && (
        <>
          <Section title="The business">
            <Row k="Name" v={b.name} />
            <Row k="Industry" v={b.industry} />
            <Row k="What you do" v={b.description} />
            <Row k="Products / services" v={(b.products_services ?? []).join(', ') || '—'} />
            <Row k="Target audience" v={b.target_audience} />
            <Row k="Value props" v={(b.value_props ?? []).join('; ') || '—'} />
            <Row k="Geography" v={b.geography} />
          </Section>

          <Section title="Brand voice">
            <Row k="Persona" v={v.persona} />
            <Row k="Tone" v={v.tone} />
            <Row k="Register" v={v.register} />
            <Row k="Vocabulary" v={(v.vocabulary ?? []).join(', ') || '—'} />
          </Section>

          <Section title={`Pages crawled · ${(meta.pages_crawled ?? []).length}`}>
            <ul className="mono" style={{ fontSize: 12, color: 'var(--clay)', margin: 0, paddingLeft: 18 }}>
              {(meta.pages_crawled ?? []).map((p: string) => <li key={p}>{p}</li>)}
            </ul>
          </Section>
        </>
      )}

      {domain?.id && (
        <Section title="Product knowledge · GitHub">
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--clay)' }}>
            Connect your product&apos;s repository and grove reads its README and docs — so
            articles can include step-by-step tutorials and feature deep-dives grounded in
            what the product actually does, not what the landing page says.
          </p>
          <RepoConnect
            domainId={domain.id}
            repo={(domain.github_repo as string | null) ?? null}
            syncedAt={repoKb?.synced_at ?? null}
          />
          {repoKb && (
            <div style={{ marginTop: 16 }}>
              <Row k="What it is" v={repoKb.product_summary} />
              {(repoKb.features ?? []).map((f) => (
                <div key={f.name} className="r-kv" style={{ padding: '8px 0', borderTop: '1px solid var(--paper)', fontSize: 14 }}>
                  <div style={{ color: 'var(--clay)' }}>{f.name}</div>
                  <div>
                    {f.what_it_does}
                    {f.how_to_use?.length > 0 && (
                      <span style={{ color: 'var(--clay)' }}> · {f.how_to_use.length} steps documented</span>
                    )}
                  </div>
                </div>
              ))}
              <Row k="Vocabulary" v={(repoKb.concepts ?? []).join(', ')} />
              <Row k="Files read" v={(repoKb.files_read ?? []).join(', ')} />
            </div>
          )}
        </Section>
      )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--gv-card)', padding: 24, borderRadius: 14, border: '1px solid var(--gv-line)', marginTop: 18 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="r-kv" style={{ padding: '8px 0', borderTop: '1px solid var(--paper)', fontSize: 14 }}>
      <div style={{ color: 'var(--clay)' }}>{k}</div>
      <div>{v || '—'}</div>
    </div>
  );
}
