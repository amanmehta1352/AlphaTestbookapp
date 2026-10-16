-- =====================================================================
-- MASTER TESTBOOK — Server database, version 2 (Admin Studio, S1)
-- Run AFTER version 1. Only adds things; safe to run twice.
--   * questions.status: draft → reviewed → published
--     (existing questions become 'published', so students see no change)
--   * students read only published + active questions; admin reads all
--   * solution fields (filled later by the Solution Studio, S3)
--   * public storage bucket for solution images; only admin can upload
-- =====================================================================

-- ---------- status ----------
alter table public.questions add column if not exists status text not null default 'published';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'questions_status_valid') then
    alter table public.questions add constraint questions_status_valid check (status in ('draft', 'reviewed', 'published'));
  end if;
end $$;
alter table public.questions add column if not exists reviewed_at timestamptz;
alter table public.questions add column if not exists published_at timestamptz;
update public.questions set published_at = created_at where status = 'published' and published_at is null;
create index if not exists questions_status_topic_idx on public.questions(status, topic_id);

-- stamp reviewed_at / published_at whenever the status changes
create or replace function public.questions_status_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'reviewed' then new.reviewed_at := now(); end if;
    if new.status = 'published' then
      new.published_at := now();
      if new.reviewed_at is null then new.reviewed_at := now(); end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists questions_status_stamp on public.questions;
create trigger questions_status_stamp before insert or update on public.questions for each row execute function public.questions_status_stamp();

-- ---------- students see only published ----------
drop policy if exists "questions: students read active" on public.questions;
drop policy if exists "questions: students read published" on public.questions;
create policy "questions: students read published" on public.questions for select to authenticated
  using ((is_active and status = 'published') or public.is_admin());

-- ---------- solution (structure filled in S3) ----------
-- solution = {"answer_line":…, "concept":…, "steps_hi":[…], "steps_en":[…], "shortcut":…,
--             "mistake":…, "target_seconds":…, "related":[question ids]}
alter table public.questions add column if not exists solution jsonb;
alter table public.questions add column if not exists solution_image text;
alter table public.questions add column if not exists solution_status text not null default 'none';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'questions_solution_status_valid') then
    alter table public.questions add constraint questions_solution_status_valid check (solution_status in ('none', 'draft', 'approved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_solution_is_object') then
    alter table public.questions add constraint questions_solution_is_object check (solution is null or jsonb_typeof(solution) = 'object');
  end if;
end $$;

-- ---------- storage for solution images ----------
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('solution-images', 'solution-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
    execute 'drop policy if exists "solution images: admin writes" on storage.objects';
    execute $p$create policy "solution images: admin writes" on storage.objects for all to authenticated
      using (bucket_id = 'solution-images' and public.is_admin())
      with check (bucket_id = 'solution-images' and public.is_admin())$p$;
  end if;
end $$;
