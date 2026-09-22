create table if not exists public.ott_games (
  id text primary key check (id ~ '^[a-z0-9-]{4,64}$'),
  state jsonb not null,
  version integer not null default 1,
  red_player text,
  blue_player text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ott_games enable row level security;

grant select, insert, update on public.ott_games to anon, authenticated;

drop policy if exists "ott_games_select_public" on public.ott_games;
create policy "ott_games_select_public"
  on public.ott_games
  for select
  to anon, authenticated
  using (true);

drop policy if exists "ott_games_insert_public" on public.ott_games;
create policy "ott_games_insert_public"
  on public.ott_games
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "ott_games_update_public" on public.ott_games;
create policy "ott_games_update_public"
  on public.ott_games
  for update
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ott_games_updated_at on public.ott_games;
create trigger set_ott_games_updated_at
  before update on public.ott_games
  for each row
  execute function public.set_updated_at();

alter table public.ott_games replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ott_games'
  ) then
    alter publication supabase_realtime add table public.ott_games;
  end if;
end;
$$;
