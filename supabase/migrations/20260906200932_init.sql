-- CertAtlas core schema.
--
-- auth.users (identity, credentials, sessions) is owned entirely by
-- Supabase Auth. Everything here is app data: a profiles row per user
-- carrying the fields auth.users doesn't hold (role, full_name, etc.), and
-- the exam-attempt tables, all foreign-keyed to auth.users.id.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  is_active boolean not null default true,
  target_exam_date timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null,
  status text not null default 'in_progress',
  set_number int,
  label text not null default '',
  question_ids jsonb not null default '[]',
  cursor int not null default 0,
  started_at timestamptz not null default now(),
  resumed_at timestamptz default now(),
  elapsed_seconds int not null default 0,
  time_limit_seconds int,
  submitted_at timestamptz,
  score_percent double precision,
  correct_count int,
  total_count int,
  passed boolean,
  domain_breakdown jsonb
);

create index ix_attempt_user_status on public.attempts (user_id, status);
create index ix_attempt_user_mode on public.attempts (user_id, mode);

create table public.attempt_answers (
  id bigint generated always as identity primary key,
  attempt_id bigint not null references public.attempts (id) on delete cascade,
  question_id text not null,
  position int not null default 0,
  selected jsonb not null default '[]',
  is_correct boolean,
  flagged boolean not null default false,
  seconds_spent int not null default 0,
  answered_at timestamptz
);

create unique index ix_answer_attempt_question
  on public.attempt_answers (attempt_id, question_id);

create table public.bookmarks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  note text,
  created_at timestamptz not null default now()
);

create unique index ix_bookmark_user_question
  on public.bookmarks (user_id, question_id);
