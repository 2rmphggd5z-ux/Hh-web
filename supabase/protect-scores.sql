-- HhGames: protect the leaderboards from fake scores and rude names.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
--
-- What this adds:
--   1. A highest possible score for each game, so nobody can post 99,999,999.
--   2. A limit on how fast scores can be added (per name, and per game overall).
--   3. A filter that blocks rude words in leaderboard names.
-- Scores already saved aren't changed. Remove any bad ones from admin.html → Scores.

-- 1. Highest possible score for each game -------------------------------------------
-- Darts: 180 is the most one visit can score.
-- Street to Superstar: 60 seconds at most 8 points a shot is well under 500.
-- Tower Stack: one point a block, and 5,000 blocks is far beyond anyone.
-- Long Shot: reputation grows with every contract; a million is far beyond anyone.
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
    when 'long-shot'           then score <= 1000000
    else true
  end
) not valid;   -- "not valid" leaves scores that are already saved alone

-- 2 and 3. Checked every time someone adds a score ----------------------------------
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

notify pgrst, 'reload schema';
