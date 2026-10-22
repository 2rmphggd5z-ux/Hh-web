-- HhGames: keep the list of games in one table instead of four separate rules.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
--
-- After this has run, adding a new game to reviews, leaderboards, play counts and bug reports is one line:
--   insert into public.games (id) values ('new-game-id');
-- (use the same id as in GAMES in index.html).

create table if not exists public.games (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$')
);
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;

insert into public.games (id) values
  ('website'),                       -- used by bug reports about the website itself
  ('track-star-3d'), ('army-rush'), ('street-to-superstar'), ('quick-chaos'), ('darts-championship'), ('tower-stack')
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

notify pgrst, 'reload schema';
