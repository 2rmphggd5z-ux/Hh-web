-- HhGames: complete database setup (reviews, leaderboards, play counts, bug reports).
-- Paste all of this into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.

-- 1. Reviews ------------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  game_id text not null
    check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship', 'tower-stack', 'number-ten')),
  rating smallint not null check (rating between 1 and 5),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  comment text not null default '' check (char_length(comment) <= 500),
  approved boolean not null default false,          -- new reviews wait for you to approve them
  created_at timestamptz not null default now(),
  constraint no_links check (comment !~* '(https?://|www\.)' and name !~* '(https?://|www\.)')
);
-- If an older reviews table exists without approval, keep its reviews visible.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'reviews' and column_name = 'approved') then
    alter table public.reviews add column approved boolean not null default true;
    alter table public.reviews alter column approved set default false;
  end if;
end $$;

alter table public.reviews enable row level security;
drop policy if exists "Anyone can read reviews" on public.reviews;
drop policy if exists "Anyone can read approved reviews" on public.reviews;
create policy "Anyone can read approved reviews" on public.reviews
  for select to anon, authenticated using (approved);
drop policy if exists "Anyone can add a review" on public.reviews;
create policy "Anyone can add a review" on public.reviews
  for insert to anon, authenticated with check (true);
-- Visitors can only fill in these four fields, so they can't approve their own review.
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert (game_id, rating, name, comment) on public.reviews to anon, authenticated;

-- 2. Leaderboards -------------------------------------------------------------------
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  game_id text not null check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'darts-championship', 'tower-stack', 'number-ten')),
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

-- 3. Play counts --------------------------------------------------------------------
create table if not exists public.play_counts (
  game_id text primary key,
  plays bigint not null default 0
);
insert into public.play_counts (game_id) values ('track-star-3d'), ('army-rush'), ('street-to-superstar'), ('darts-championship'), ('tower-stack'), ('number-ten')
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

-- 4. Bug reports (private: read them in Table Editor → reports) --------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  about text not null check (about in ('website', 'track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship', 'tower-stack', 'number-ten')),
  message text not null check (char_length(btrim(message)) between 10 and 1000),
  name text not null default '' check (char_length(name) <= 40),
  device text not null default '' check (char_length(device) <= 120),
  fixed boolean not null default false,             -- tick this when you've sorted it
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
drop policy if exists "Anyone can send a report" on public.reports;
create policy "Anyone can send a report" on public.reports
  for insert to anon, authenticated with check (true);
-- No read policy: reports are private to you.
revoke all on public.reports from anon, authenticated;
grant insert (about, message, name, device) on public.reports to anon, authenticated;

-- 5. Leaderboard protection: highest possible scores, rate limits, name filter -----
-- Darts: 180 is the most one visit can score.
-- Street to Superstar: 60 seconds at most 8 points a shot is well under 500.
-- Tower Stack: one point a block, and 5,000 blocks is far beyond anyone.
-- Number 10: a career is at most five terms of 8,600 (650 seats, five years served) plus 1,500 for a full Treasury: 44,500.
-- Track Star 3D and Army Rush: change these if real players ever get close.
alter table public.scores drop constraint if exists scores_max_check;
alter table public.scores add constraint scores_max_check check (
  case game_id
    when 'darts-championship'  then score <= 180
    when 'street-to-superstar' then score <= 500
    when 'army-rush'           then score <= 1000
    when 'track-star-3d'       then score <= 10000000
    when 'tower-stack'         then score <= 5000
    when 'number-ten'          then score <= 44500
    else true
  end
) not valid;   -- "not valid" leaves scores that are already saved alone

-- Checked every time someone adds a score.
create or replace function public.check_new_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The name with spaces and symbols removed and look-alike numbers swapped for letters,
  -- so "F u_c k" and "5h1t" are caught too.
  squashed text := translate(regexp_replace(lower(new.name), '[^a-z0-9@$!]', '', 'g'), '013457@$!', 'oieastasi');
begin
  -- Words are only listed if they can't hide inside a normal name (so not "ass", which is in "Cassie").
  if squashed ~ '(fuck|fuk|shit|cunt|bitch|nigg|wank|twat|slut|whore|penis|vagina|porn|bastard|bollock|piss|retard|nazi|hitler|dildo|boob|tits)' then
    raise exception 'name_not_allowed' using hint = 'Pick a different name for the leaderboard.';
  end if;

  if (select count(*) from public.scores
      where game_id = new.game_id and lower(btrim(name)) = lower(btrim(new.name))
        and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too_many_scores' using hint = 'Wait a few minutes before adding another score.';
  end if;

  if (select count(*) from public.scores
      where game_id = new.game_id and created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'too_many_scores' using hint = 'Wait a few minutes before adding another score.';
  end if;

  return new;
end;
$$;
revoke all on function public.check_new_score() from public;

drop trigger if exists check_new_score on public.scores;
create trigger check_new_score before insert on public.scores
  for each row execute function public.check_new_score();

create index if not exists scores_recent on public.scores (game_id, created_at desc);

-- 6. One list of games. To add a game later: insert into public.games (id) values ('new-game-id');
create table if not exists public.games (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$')
);
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;

insert into public.games (id) values
  ('website'),                       -- used by bug reports about the website itself
  ('track-star-3d'), ('army-rush'), ('street-to-superstar'), ('quick-chaos'), ('darts-championship'), ('tower-stack'), ('number-ten')
on conflict (id) do nothing;

-- Every game gets a play counter automatically.
create or replace function public.add_play_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> 'website' then
    insert into public.play_counts (game_id) values (new.id) on conflict (game_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.add_play_counter() from public;
drop trigger if exists add_play_counter on public.games;
create trigger add_play_counter after insert on public.games
  for each row execute function public.add_play_counter();
insert into public.play_counts (game_id) select id from public.games where id <> 'website' on conflict (game_id) do nothing;

-- Swap the old "which games are allowed" lists for a link to the games table.
do $$
declare c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.reviews'::regclass, 'public.scores'::regclass, 'public.reports'::regclass)
      and pg_get_constraintdef(oid) like '%= ANY%track-star-3d%'   -- only the "game is in this list" rules, not the score caps
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.reviews drop constraint if exists reviews_game_fk;
alter table public.reviews add constraint reviews_game_fk foreign key (game_id) references public.games (id);
alter table public.scores drop constraint if exists scores_game_fk;
alter table public.scores add constraint scores_game_fk foreign key (game_id) references public.games (id);
alter table public.reports drop constraint if exists reports_about_fk;
alter table public.reports add constraint reports_about_fk foreign key (about) references public.games (id);

-- Make the website see the new tables straight away.
notify pgrst, 'reload schema';
