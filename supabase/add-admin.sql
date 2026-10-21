-- HhGames admin: lets you, and only you, manage reviews, bug reports and scores from admin.html.
--
-- Before running this:
--   1. Supabase → Authentication → Users → Add user → Create new user.
--      Enter your email and a strong password, and tick "Auto Confirm User".
--   2. Change the email on the line marked CHANGE ME below to that same email.
-- Then paste everything into SQL Editor → New query and tap Run. Safe to run more than once.
-- The last line shows your email if it worked. If it shows no rows, the email doesn't match a user.

-- Who is an admin. Nobody can read or change this list from the website.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

insert into public.admins (user_id)
select id from auth.users
where lower(email) = lower('you@example.com')          -- CHANGE ME to your email
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Reviews: admins see every review, approve or hide them, and delete them.
drop policy if exists "Admin reads all reviews" on public.reviews;
create policy "Admin reads all reviews" on public.reviews for select to authenticated using (public.is_admin());
drop policy if exists "Admin approves reviews" on public.reviews;
create policy "Admin approves reviews" on public.reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin deletes reviews" on public.reviews;
create policy "Admin deletes reviews" on public.reviews for delete to authenticated using (public.is_admin());
grant update (approved) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

-- Bug reports: admins read them, mark them fixed and delete them.
drop policy if exists "Admin reads reports" on public.reports;
create policy "Admin reads reports" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "Admin updates reports" on public.reports;
create policy "Admin updates reports" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin deletes reports" on public.reports;
create policy "Admin deletes reports" on public.reports for delete to authenticated using (public.is_admin());
grant select on public.reports to authenticated;
grant update (fixed) on public.reports to authenticated;
grant delete on public.reports to authenticated;

-- Scores: admins can remove a score (everyone can already read them).
drop policy if exists "Admin deletes scores" on public.scores;
create policy "Admin deletes scores" on public.scores for delete to authenticated using (public.is_admin());
grant delete on public.scores to authenticated;

notify pgrst, 'reload schema';

-- Check: this should list your email.
select u.email as admin_email from auth.users u join public.admins a on a.user_id = u.id;
