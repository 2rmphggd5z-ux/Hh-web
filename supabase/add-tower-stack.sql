-- HhGames: add Tower Stack to reviews, leaderboards, play counts and bug reports.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
-- Until this has run, Tower Stack can be played but its scores, reviews and play count won't save.

do $$
declare c record;
begin
  -- Drop the old "which games are allowed" rules so they can be replaced with the new list.
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

alter table public.reviews add constraint reviews_game_id_check
  check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship', 'tower-stack'));
alter table public.scores add constraint scores_game_id_check
  check (game_id in ('track-star-3d', 'army-rush', 'street-to-superstar', 'darts-championship', 'tower-stack'));
alter table public.reports add constraint reports_about_check
  check (about in ('website', 'track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos', 'darts-championship', 'tower-stack'));

insert into public.play_counts (game_id) values ('darts-championship'), ('tower-stack') on conflict (game_id) do nothing;

notify pgrst, 'reload schema';
