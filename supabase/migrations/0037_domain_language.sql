-- Publication language, one per domain.
--
-- Until now the pipeline had no language setting at all: every prompt was
-- written in English, and what came out was whatever the model inferred from
-- the site profile (in practice, English — all 53 live posts on the first
-- customer domain are English despite a Korean business). This column is the
-- single input that decides what language an article is written in, what the
-- scaffold labels say, how its length is measured, and what `inLanguage` /
-- <html lang> the public surfaces emit.
--
-- Default 'en' so every existing domain keeps behaving exactly as it does
-- today. Deliberately a plain text column with a CHECK rather than an enum:
-- adding a language should be a one-line migration, not an ALTER TYPE.
alter table public.domains
  add column if not exists language text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'domains_language_check'
  ) then
    alter table public.domains
      add constraint domains_language_check
      check (language in ('en', 'ko', 'es', 'zh'));
  end if;
end $$;

comment on column public.domains.language is
  'Language every article for this domain is written in (lib/language.ts). en | ko | es | zh.';
