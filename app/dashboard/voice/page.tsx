import { supabaseServer } from '@/lib/supabase/server';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const voice = domain?.brand_voice as any;

  return (
    <>
      <h2 className="h2">Brand voice</h2>
      {voice ? (
        <div style={{ background: 'white', padding: 28, borderRadius: 14, border: '1px solid var(--line)', marginTop: 18 }}>
          <p><b>Persona:</b> {voice.persona}</p>
          <p><b>Tone:</b> {voice.tone}</p>
          <p><b>Register:</b> {voice.register}</p>
          {voice.vocabulary && <p><b>Vocabulary:</b> {voice.vocabulary.join(', ')}</p>}
        </div>
      ) : (
        <p className="lede">Voice profiling runs in the background after verification. Refresh in a minute.</p>
      )}
    </>
  );
}
