-- HhGames: add Long Shot to reviews, leaderboards, play counts and bug reports.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
-- Until this has run, Long Shot can be played but its scores, reviews and play count won't save.

insert into public.games (id) values ('long-shot') on conflict (id) do nothing;   -- also adds its play counter

-- Highest possible score for each game. Long Shot's reputation grows with every contract; a million is far beyond anyone.
alter table public.scores drop constraint if exists scores_max_check;
alter table public.scores add constraint scores_max_check check (
  case game_id
    when 'darts-championship'  then score <= 180
    when 'street-to-superstar' then score <= 500
    when 'army-rush'           then score <= 1000
    when 'track-star-3d'       then score <= 10000000
    when 'tower-stack'         then score <= 5000
    when 'number-ten'          then score <= 44500
    when 'long-shot'           then score <= 1000000
    else true
  end
) not valid;   -- "not valid" leaves scores that are already saved alone

notify pgrst, 'reload schema';
