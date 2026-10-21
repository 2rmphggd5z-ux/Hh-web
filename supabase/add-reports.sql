-- HhGames: bug reports from the About page.
-- Paste into Supabase → SQL Editor → New query, then tap Run. Safe to run more than once.
-- Read reports in Table Editor → reports. Visitors can send reports but can never read them.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  about text not null check (about in ('website', 'track-star-3d', 'army-rush', 'street-to-superstar', 'quick-chaos')),
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

notify pgrst, 'reload schema';
