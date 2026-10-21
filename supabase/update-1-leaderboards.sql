-- HhGames update 1: review approval, leaderboards and play counts.
-- Paste all of this into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.

-- 1. Reviews wait for approval -------------------------------------------------
-- New reviews start hidden. To approve one: Table Editor → reviews → tick "approved".
-- Reviews posted before this update stay visible; this only happens the first time the script runs.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'reviews' and column_name = 'approved') then
    alter table public.reviews add column approved boolean not null default true;
    alter table public.reviews alter column approved set default false;
  end if;
end $$;

drop policy if exists "Anyone can read reviews" on public.reviews;
drop policy if exists "Anyone can read approved reviews" on public.reviews;
create policy "Anyone can read approved reviews" on public.reviews
  for select to anon, authenticated using (approved);
-- Visitors still can only fill in game, rating, name and comment, so they can't approve their own review.

-- 2. Leaderboards ---------------------------------------------------------------
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  game_id text not null check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar')),
  name text not null check (char_length(btrim(name)) between 1 and 20 and name !~* '(https?://|www\.)'),
  score integer not null check (score between 1 and 100000000),
  created_at timestamptz not null default now()
);
create index if not exists scores_by_game on public.scores (game_id, score desc, created_at);

alter table public.scores enable row level security;
drop policy if exists "Anyone can read scores" on public.scores;
create policy "Anyone can read scores" on public.scores for select to anon, authenticated using (true);
drop policy if exists "Anyone can add a score" on public.scores;
create policy "Anyone can add a score" on public.scores for insert to anon, authenticated with check (true);
revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant insert (game_id, name, score) on public.scores to anon, authenticated;

-- 3. Play counts ----------------------------------------------------------------
create table if not exists public.play_counts (
  game_id text primary key,
  plays bigint not null default 0
);
insert into public.play_counts (game_id) values ('track-star-3d'), ('army-rush'), ('street-to-superstar')
  on conflict (game_id) do nothing;

alter table public.play_counts enable row level security;
drop policy if exists "Anyone can read play counts" on public.play_counts;
create policy "Anyone can read play counts" on public.play_counts for select to anon, authenticated using (true);
revoke all on public.play_counts from anon, authenticated;
grant select on public.play_counts to anon, authenticated;

-- Visitors can only add 1 to a game's count, nothing else.
create or replace function public.count_play(game text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.play_counts set plays = plays + 1 where game_id = game;
$$;
revoke all on function public.count_play(text) from public;
grant execute on function public.count_play(text) to anon, authenticated;
