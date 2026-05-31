-- grove core schema
create extension if not exists pgcrypto;

-- =========================================================
-- domains
-- =========================================================
create table public.domains (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  hostname        text not null,            -- e.g. yourdomain.com (apex)
  blog_slug       text not null unique,     -- subdomain on the grove root, e.g. blog-abc123
  verify_token    text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at     timestamptz,
  brand_voice     jsonb,                    -- {persona, tone, register, vocabulary[]}
  posts_per_week  int not null default 4,
  auto_publish    boolean not null default false,  -- true = full autopilot
  created_at      timestamptz not null default now(),
  unique (user_id, hostname)
);
create index on public.domains (user_id);

-- =========================================================
-- posts (the pipeline records)
-- =========================================================
create type public.post_status as enum (
  'queued', 'researching', 'writing', 'review', 'scheduled', 'published', 'failed'
);

create table public.posts (
  id                uuid primary key default gen_random_uuid(),
  domain_id         uuid not null references public.domains(id) on delete cascade,
  status            public.post_status not null default 'queued',
  topic             text,                    -- input keyword or brief
  title             text,
  slug              text,
  body_md           text,
  meta_title        text,
  meta_description  text,
  social            jsonb,                   -- {x, linkedin, instagram}
  research          jsonb,                   -- agent 1 output
  validation        jsonb,                   -- {passed, issues, stats}
  scheduled_at      timestamptz,
  published_at      timestamptz,
  reads             int not null default 0,
  created_at        timestamptz not null default now()
);
create index on public.posts (domain_id, status);
create index on public.posts (scheduled_at) where status in ('scheduled','review');
create unique index posts_domain_slug_uq on public.posts (domain_id, slug) where slug is not null;

-- =========================================================
-- topic memory (so grove never repeats itself)
-- =========================================================
create table public.topic_memory (
  id          uuid primary key default gen_random_uuid(),
  domain_id   uuid not null references public.domains(id) on delete cascade,
  keyword     text not null,
  embedding   vector,                       -- optional; nullable until pgvector enabled
  created_at  timestamptz not null default now()
);
create index on public.topic_memory (domain_id);

-- =========================================================
-- plans / subscription
-- =========================================================
create table public.subscriptions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan           text not null default 'starter', -- starter | growth | agency
  posts_quota    int not null default 4,
  posts_used     int not null default 0,
  cycle_resets_at timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  trial_ends_at  timestamptz default (now() + interval '14 days')
);

-- =========================================================
-- RLS
-- =========================================================
alter table public.domains       enable row level security;
alter table public.posts         enable row level security;
alter table public.topic_memory  enable row level security;
alter table public.subscriptions enable row level security;

create policy "own domains" on public.domains
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own posts" on public.posts
  for all using (
    exists (select 1 from public.domains d where d.id = posts.domain_id and d.user_id = auth.uid())
  );

create policy "own topic memory" on public.topic_memory
  for all using (
    exists (select 1 from public.domains d where d.id = topic_memory.domain_id and d.user_id = auth.uid())
  );

create policy "own subscription" on public.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- public read for published posts (powers /b/<slug> blogs + embed)
create policy "published posts are public" on public.posts
  for select to anon
  using (status = 'published');

create policy "domains readable to anon for published lookup" on public.domains
  for select to anon
  using (true);

-- =========================================================
-- helper: create subscription row when user signs up
-- =========================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
