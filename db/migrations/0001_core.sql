-- 0001_core.sql  (additive only: never edit after applying; never DROP/DELETE/rename)
create schema if not exists mtb;

create table if not exists mtb.exams (
  id serial primary key, slug text unique not null,
  name_en text not null, name_hi text not null,
  level text not null default 'diploma', active boolean not null default true,
  pattern jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists mtb.branches (
  id serial primary key, slug text unique not null,
  name_en text not null, name_hi text not null, sort int not null default 0);
create table if not exists mtb.exam_branches (
  exam_id int not null references mtb.exams(id), branch_id int not null references mtb.branches(id),
  primary key (exam_id, branch_id));
create table if not exists mtb.subjects (
  id serial primary key, slug text unique not null,
  name_en text not null, name_hi text not null,
  branch_id int references mtb.branches(id));          -- NULL = common to all branches
create table if not exists mtb.topics (
  id serial primary key, subject_id int not null references mtb.subjects(id),
  parent_id int references mtb.topics(id), slug text not null,
  name_en text not null, name_hi text not null, sort int not null default 0,
  unique (subject_id, slug));
create table if not exists mtb.sources (
  id serial primary key, exam_id int not null references mtb.exams(id),
  exam_year int not null, shift int, paper_date date,
  kind text not null check (kind in ('official_paper','official_answer_key','official_response_sheet')),
  url text, file_sha256 text, verified_at timestamptz,
  unique (exam_id, paper_date, shift, kind));
create table if not exists mtb.questions (
  id bigserial primary key,
  kind text not null check (kind in ('pyq','practice')),
  source_id int references mtb.sources(id), source_qno int,
  topic_id int not null references mtb.topics(id),
  stem jsonb not null, options jsonb not null,
  answer smallint not null, solution jsonb,
  difficulty smallint check (difficulty between 1 and 5),
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  content_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint pyq_needs_source check (kind <> 'pyq' or source_id is not null),
  constraint options_ok check (jsonb_typeof(options) = 'array' and answer >= 0 and answer < jsonb_array_length(options)),
  unique (source_id, source_qno));
create index if not exists questions_topic_idx on mtb.questions(topic_id) where status = 'published';

create table if not exists mtb.profiles (
  user_id uuid primary key, exam_id int references mtb.exams(id), branch_id int references mtb.branches(id),
  target_date date, daily_minutes int check (daily_minutes between 10 and 600),
  lang text not null default 'both' check (lang in ('hi','en','both')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists mtb.attempts (
  id bigserial primary key, user_id uuid not null, question_id bigint not null references mtb.questions(id),
  chosen smallint, correct boolean not null, ms int, mode text not null default 'practice'
  check (mode in ('practice','mock','revision')), created_at timestamptz not null default now());
create index if not exists attempts_user_idx on mtb.attempts(user_id, created_at desc);
create table if not exists mtb.revision_cards (
  user_id uuid not null, question_id bigint not null references mtb.questions(id),
  step smallint not null default 0, due_on date not null default current_date, last_correct boolean,
  primary key (user_id, question_id));

alter table mtb.profiles enable row level security;
alter table mtb.attempts enable row level security;
alter table mtb.revision_cards enable row level security;
alter table mtb.questions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='own_profile') then
    create policy own_profile on mtb.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_attempts on mtb.attempts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_cards on mtb.revision_cards for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy read_published on mtb.questions for select using (status = 'published');
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    grant usage on schema mtb to anon, authenticated;
    grant select on mtb.exams, mtb.branches, mtb.exam_branches, mtb.subjects, mtb.topics, mtb.sources, mtb.questions to anon, authenticated;
    grant select, insert, update on mtb.profiles, mtb.revision_cards to authenticated;
    grant select, insert on mtb.attempts to authenticated;
    grant usage on all sequences in schema mtb to authenticated;
  end if;
end $$;
