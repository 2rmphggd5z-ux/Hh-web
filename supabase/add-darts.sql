-- HhGames: add Darts Champion to reviews, leaderboards, play counts and bug reports.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
-- Until this has run, Darts Champion can be played but its reviews, leaderboard and play count won't save.

do $$
declare c record;
begin
  -- Drop the old "which games are allowed" rules so they can be replaced with the new list.
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.reviews'::regclass, 'public.scores'::regclass, 'public.reports'::regclass)
      and (pg_get_constraintdef(oid) like '%game_id%track-star-3d%' or pg_get_constraintdef(oid) like '%about%track-star-3d%')
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.reviews add constraint reviews_game_id_check
  check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship'));
alter table public.scores add constraint scores_game_id_check
  check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'darts-championship'));
alter table public.reports add constraint reports_about_check
  check (about in ('website', 'track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship'));

insert into public.play_counts (game_id) values ('darts-championship') on conflict (game_id) do nothing;
