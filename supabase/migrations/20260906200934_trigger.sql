-- Every new auth.users row (password sign-up, Google, or GitHub — Supabase
-- Auth treats all three identically once a user exists) gets exactly one
-- profiles row, created here rather than in application code, so there is
-- no window where a signed-in user has no profile for FastAPI to load.
--
-- role always starts as 'user'. There is deliberately no "first user
-- becomes admin" logic here (unlike the old SQLite-backed app) — that
-- one-time-ever check doesn't have a race-free expression as a per-row
-- trigger. Promote the first real account manually after signing up:
--   update public.profiles set role = 'admin' where email = '...';

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
