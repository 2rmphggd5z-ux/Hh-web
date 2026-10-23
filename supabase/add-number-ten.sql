-- HhGames: add Number 10 to reviews, leaderboards, play counts and bug reports.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
-- Needs add-games-table.sql to have run first (setup-all.sql already includes it).
-- Until this has run, Number 10 can be played but its scores, reviews and play count won't save.

insert into public.games (id) values ('number-ten') on conflict (id) do nothing;   -- also adds its play counter

-- Highest possible score: five terms of 8,600 (650 seats and five years served each) plus 1,500 for a full Treasury: 44,500.
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

notify pgrst, 'reload schema';
