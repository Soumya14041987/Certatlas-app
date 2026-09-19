-- Row Level Security: a deny-by-default safety net over Supabase's
-- auto-generated PostgREST API, not the app's authorization mechanism.
--
-- FastAPI is the only thing that ever queries these tables in normal
-- operation, connecting with a fixed Postgres role that bypasses RLS by
-- construction — real ownership/admin checks live there (api/deps.py),
-- unchanged from before this migration. These policies exist purely so
-- that the anon/authenticated PostgREST surface Supabase exposes by
-- default — reachable via the necessarily-public anon key — cannot read
-- another user's rows, even though the frontend never calls it directly
-- today. No INSERT/UPDATE/DELETE policies are granted anywhere: FastAPI is
-- the only writer.

alter table public.profiles enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.bookmarks enable row level security;

create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "select own attempts" on public.attempts
  for select using (auth.uid() = user_id);

create policy "select own answers" on public.attempt_answers
  for select using (
    auth.uid() = (
      select user_id from public.attempts where id = attempt_answers.attempt_id
    )
  );

create policy "select own bookmarks" on public.bookmarks
  for select using (auth.uid() = user_id);
