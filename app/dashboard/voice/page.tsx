import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import type { RepoKnowledge } from '@/lib/pipeline/repo-knowledge';
import CrawlButton from './CrawlButton';
import RepoConnect from './RepoConnect';
import RepoDocsToggle from './RepoDocsToggle';
import { DashHeader } from '../gv-chrome';
import Icon from '../gv-icons';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="gv-chip" style={{ fontSize: 11.5, color: 'var(--gv-soft)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '5px 11px' }}>{children}</span>
  );
}

export default async function Page() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const profile = (domain?.site_profile ?? {}) as any;
  const b = profile.business ?? {};
  const v = profile.voice ?? {};
  const meta = profile.meta ?? {};
  const hasProfile = !!b.name;
  const repoKb = (domain?.repo_knowledge ?? null) as RepoKnowledge | null;
  const repo = (domain?.github_repo as string | null) ?? null;
  const pagesCrawled: string[] = meta.pages_crawled ?? [];
  const docsCount = (repoKb?.features?.length ?? 0) + (repoKb?.concepts ? 1 : 0);

  return (
    <>
      <DashHeader title="Brand voice" subtitle="the context grove writes from" />
      <div className="gv-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
          <p style={{ fontSize: 14, color: 'var(--gv-dim)', lineHeight: 1.6, margin: 0, maxWidth: 640 }}>
            Context grove uses for every article. The more accurate, the more on-brand the writing.
          </p>
          {domain?.id && <CrawlButton domainId={domain.id} hostname={domain.hostname} />}
        </div>

        {!hasProfile && (
          <div style={{ background: 'var(--gv-card)', border: '1px dashed rgba(255,255,255,0.14)', borderRadius: 14, padding: '32px 26px', textAlign: 'center' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>No profile yet.</h3>
            <p style={{ color: 'var(--gv-dim)', marginTop: 8, fontSize: 13.5, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
              Click <b style={{ color: 'var(--gv-soft)' }}>Crawl my site</b> above. It hits your homepage, /about, /pricing, /products, /services,
              and /contact, then extracts what you do, who you sell to, and your brand voice.
            </p>
          </div>
        )}

        {(hasProfile || domain?.id) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* LEFT COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {hasProfile && (
                <>
                  {/* BUSINESS CARD */}
                  <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gv-dim)', flexShrink: 0 }}><Icon name="building" size={17} /></span>
                      <div style={{ lineHeight: 1.25 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{b.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--gv-faint)' }}>{[b.industry, b.geography].filter(Boolean).join(' · ') || 'Business profile'}</div>
                      </div>
                    </div>

                    {b.description && <p style={{ fontSize: 13.5, color: 'var(--gv-soft)', lineHeight: 1.6, margin: '0 0 18px' }}>{b.description}</p>}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>Products &amp; services</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(b.products_services ?? []).length ? (b.products_services as string[]).map((p) => <Chip key={p}>{p}</Chip>) : <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>—</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>Target audience</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {b.target_audience ? <Chip>{b.target_audience}</Chip> : <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>—</span>}
                        </div>
                      </div>
                    </div>

                    {(b.value_props ?? []).length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>Value props</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                          {(b.value_props as string[]).map((vp) => (
                            <div key={vp} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--gv-soft)', lineHeight: 1.4 }}>
                              <span style={{ color: 'var(--gv-accent)', flexShrink: 0, marginTop: 1 }}><Icon name="check" size={12} /></span>{vp}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* VOICE CARD */}
                  <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gv-dim)', flexShrink: 0 }}><Icon name="voice" size={17} /></span>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>Brand voice</div>
                    </div>

                    {v.persona && (
                      <div style={{ display: 'flex', gap: 10, padding: '14px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 18 }}>
                        <span style={{ color: 'var(--gv-fainter)', flexShrink: 0, fontSize: 20, lineHeight: 1, fontWeight: 800 }}>&ldquo;</span>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--gv-soft)', lineHeight: 1.55, fontStyle: 'italic' }}>{v.persona}</p>
                      </div>
                    )}

                    {v.tone && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>Tone</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {String(v.tone).split(/,\s*/).filter(Boolean).map((t: string) => (
                            <span key={t} style={{ fontSize: 11.5, fontWeight: 600, color: '#d9ff8f', background: 'rgba(162,255,1,0.1)', border: '1px solid rgba(162,255,1,0.28)', borderRadius: 999, padding: '5px 11px' }}>{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {v.register && (
                      <div style={{ marginBottom: 16, fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--gv-fainter)' }}>Register — </span>{v.register}
                      </div>
                    )}

                    {(v.vocabulary ?? []).length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 9 }}>Vocabulary</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(v.vocabulary as string[]).map((word) => (
                            <span key={word} className="gv-chip" style={{ fontSize: 11.5, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 999, padding: '5px 11px', fontFamily: "'SF Mono', ui-monospace, monospace" }}>{word}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* RIGHT COLUMN: SOURCES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>Sources</div>
                <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 18 }}>What grove reads before writing</div>

                {/* site crawl */}
                {hasProfile && (
                  <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <span style={{ display: 'flex', color: 'var(--gv-dim)' }}><Icon name="globe" size={15} /></span>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domain?.hostname}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gv-on-accent)', background: 'var(--gv-accent)', borderRadius: 999, padding: '2px 8px' }}>{pagesCrawled.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {pagesCrawled.length ? pagesCrawled.map((p) => (
                        <span key={p} style={{ fontSize: 11, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '4px 8px', fontFamily: "'SF Mono', ui-monospace, monospace" }}>{p}</span>
                      )) : <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>No pages recorded</span>}
                    </div>
                  </div>
                )}

                {/* github */}
                {domain?.id && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                      <span style={{ display: 'flex', color: 'var(--gv-dim)' }}><Icon name="github" size={15} /></span>
                      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'SF Mono', ui-monospace, monospace", flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{repo ?? 'Not connected'}</span>
                      {repoKb && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#d9ff8f' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gv-accent)' }} />Synced
                        </span>
                      )}
                    </div>
                    {repoKb?.synced_at && (
                      <div style={{ fontSize: 11, color: 'var(--gv-fainter)', marginBottom: 12 }}>last read {new Date(repoKb.synced_at).toLocaleString('en-US')}</div>
                    )}
                    {repoKb?.product_summary && (
                      <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.5, margin: '0 0 12px' }}>{repoKb.product_summary}</p>
                    )}

                    {repoKb && docsCount > 0 && (
                      <RepoDocsToggle count={docsCount}>
                        {(repoKb.features ?? []).map((f) => (
                          <div key={f.name}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace" }}>{f.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', lineHeight: 1.45, marginTop: 2 }}>
                              {f.what_it_does}
                              {(f.how_to_use?.length ?? 0) > 0 && ` · ${f.how_to_use.length} step${f.how_to_use.length === 1 ? '' : 's'} documented`}
                            </div>
                          </div>
                        ))}
                        {(repoKb.concepts ?? []).length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gv-soft)' }}>Vocabulary</div>
                            <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', lineHeight: 1.45, marginTop: 2 }}>{(repoKb.concepts as string[]).join(', ')}</div>
                          </div>
                        )}
                        {(repoKb.files_read ?? []).length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--gv-fainter)', paddingTop: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>Files read: {(repoKb.files_read as string[]).join(', ')}</div>
                        )}
                      </RepoDocsToggle>
                    )}

                    <RepoConnect domainId={domain.id} repo={repo} syncedAt={repoKb?.synced_at ?? null} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
