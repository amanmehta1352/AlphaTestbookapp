-- =====================================================================
-- MASTER TESTBOOK — Server database, version 1
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to run twice.
-- Content (questions) is written only by admins. Each student can read
-- and write only their own progress.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- admins ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins: see own row" on public.admins;
create policy "admins: see own row" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

-- ---------- content: exams, topics, questions ----------
create table if not exists public.exams (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  name text not null,
  board text,
  category text,
  marking text,
  created_at timestamptz not null default now()
);

create table if not exists public.topics (
  id text primary key,                         -- e.g. maths-percentage-class-test
  workspace text not null default 'competitive',
  subject text not null,
  chapter text not null,
  title text not null,
  exam_id text references public.exams(id),
  year smallint check (year between 1950 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id text primary key,                         -- IMP-…
  file_name text not null,
  topic_id text references public.topics(id) on delete set null,
  added int not null default 0,
  changed int not null default 0,
  unchanged int not null default 0,
  removed int not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id text primary key check (length(id) between 3 and 160),   -- stable, never changes
  topic_id text not null references public.topics(id) on delete restrict,
  workspace text not null default 'competitive',
  exam_id text references public.exams(id),
  year smallint check (year between 1950 and 2100),
  shift text,
  subject text not null,
  chapter text not null,
  topic text not null,
  subtopic text,
  question_no int check (question_no > 0),
  format text not null default 'MCQ' check (format in ('MCQ', 'SUBJECTIVE')),
  question_en text,
  question_hi text,
  options jsonb not null default '[]'::jsonb,   -- [{"letter":"A","en":"…","hi":"…"}, …]
  answer char(1) check (answer in ('A', 'B', 'C', 'D')),
  explanation_en text,
  explanation_hi text,
  source_type text check (source_type in ('PYQ', 'PRACTICE')),   -- null = not marked yet
  difficulty text check (difficulty in ('EASY', 'MODERATE', 'HARD')), -- null = not given
  content_hash text,
  is_active boolean not null default true,
  import_batch_id text references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_has_text check (coalesce(question_en, '') <> '' or coalesce(question_hi, '') <> ''),
  constraint mcq_is_complete check (
    format = 'SUBJECTIVE'
    or (answer is not null and jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
  )
);
create index if not exists questions_topic_idx on public.questions(topic_id);
create index if not exists questions_exam_year_idx on public.questions(exam_id, year);
create index if not exists questions_subject_idx on public.questions(subject, chapter);
create index if not exists questions_source_idx on public.questions(source_type) where source_type is not null;

drop trigger if exists topics_touch on public.topics;
create trigger topics_touch before update on public.topics for each row execute function public.touch_updated_at();
drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before update on public.questions for each row execute function public.touch_updated_at();

alter table public.exams enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.import_batches enable row level security;

drop policy if exists "exams: students read" on public.exams;
create policy "exams: students read" on public.exams for select to authenticated using (true);
drop policy if exists "exams: admin writes" on public.exams;
create policy "exams: admin writes" on public.exams for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "topics: students read" on public.topics;
create policy "topics: students read" on public.topics for select to authenticated using (true);
drop policy if exists "topics: admin writes" on public.topics;
create policy "topics: admin writes" on public.topics for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "questions: students read active" on public.questions;
create policy "questions: students read active" on public.questions for select to authenticated using (is_active or public.is_admin());
drop policy if exists "questions: admin writes" on public.questions;
create policy "questions: admin writes" on public.questions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "imports: admin only" on public.import_batches;
create policy "imports: admin only" on public.import_batches for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- student data: each student sees only their own ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (length(display_name) <= 80),
  target_exam text references public.exams(id),
  exam_date date,
  daily_goal smallint check (daily_goal between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create table if not exists public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,                      -- id made on the phone; makes offline sync safe to repeat
  question_id text not null references public.questions(id) on delete cascade,
  chosen char(1) check (chosen in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  seconds int check (seconds between 0 and 3600),
  mode text not null default 'practice' check (mode in ('practice', 'test', 'revision')),
  session_id text,
  answered_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists attempts_user_time_idx on public.attempts(user_id, answered_at desc);
create index if not exists attempts_user_question_idx on public.attempts(user_id, question_id);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null,
  exam_id text references public.exams(id),
  year smallint,
  question_ids text[] not null,
  answers jsonb not null default '{}'::jsonb,
  correct int not null default 0 check (correct >= 0),
  wrong int not null default 0 check (wrong >= 0),
  skipped int not null default 0 check (skipped >= 0),
  score numeric(7, 2),
  duration_seconds int check (duration_seconds >= 0),
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists results_user_time_idx on public.results(user_id, submitted_at desc);

create table if not exists public.bookmarks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.review_cards (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  box smallint not null default 0 check (box between 0 and 10),
  due_on date not null default current_date,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
drop trigger if exists review_cards_touch on public.review_cards;
create trigger review_cards_touch before update on public.review_cards for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.attempts enable row level security;
alter table public.results enable row level security;
alter table public.bookmarks enable row level security;
alter table public.review_cards enable row level security;

drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- attempts and results are a diary: add and read your own, never edit
drop policy if exists "attempts: read own" on public.attempts;
create policy "attempts: read own" on public.attempts for select to authenticated using (user_id = auth.uid());
drop policy if exists "attempts: add own" on public.attempts;
create policy "attempts: add own" on public.attempts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "results: read own" on public.results;
create policy "results: read own" on public.results for select to authenticated using (user_id = auth.uid());
drop policy if exists "results: add own" on public.results;
create policy "results: add own" on public.results for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "bookmarks: own" on public.bookmarks;
create policy "bookmarks: own" on public.bookmarks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "review: own" on public.review_cards;
create policy "review: own" on public.review_cards for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- a profile row appears automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), 80))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- nobody without a login can read anything
revoke all on all tables in schema public from anon;
