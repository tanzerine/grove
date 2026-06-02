import { supabaseServer } from '@/lib/supabase/server';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const profile = (domain?.site_profile ?? {}) as any;
  const b = profile.business ?? {};
  const v = profile.voice ?? {};
  const meta = profile.meta ?? {};

  if (!b.name) {
    return (
      <>
        <h2 className="h2">Business profile</h2>
        <p className="lede">Crawling your site… refresh in a minute.</p>
      </>
    );
  }

  return (
    <>
      <h2 className="h2">Business profile</h2>
      <p className="lede">This is the context grove uses for every article. The more accurate, the better the writing.</p>

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

      <Section title="Pages crawled">
        <ul className="mono" style={{ fontSize: 12, color: 'var(--clay)', margin: 0, paddingLeft: 18 }}>
          {(meta.pages_crawled ?? []).map((p: string) => <li key={p}>{p}</li>)}
        </ul>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', padding: 24, borderRadius: 14, border: '1px solid var(--line)', marginTop: 18 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, padding: '8px 0', borderTop: '1px solid var(--paper)', fontSize: 14 }}>
      <div style={{ color: 'var(--clay)' }}>{k}</div>
      <div>{v || '—'}</div>
    </div>
  );
}
