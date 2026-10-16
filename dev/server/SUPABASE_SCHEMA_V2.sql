-- =====================================================================
-- MASTER TESTBOOK — Server database, version 2 (Admin Studio, S1)
-- Run AFTER version 1. Only adds/alters things (no DROP); safe to run twice.
-- APPLIED on the live project 2026-10-16. Backup taken first into schema
-- backup.*_20261016 (questions, topics, exams, import_batches).
--   * questions.status: draft → reviewed → published
--     (existing questions become 'published', so students see no change)
--   * students read only published + active questions; admin reads all
--   * solution fields (filled later by the Solution Studio, S3)
--   * public storage bucket for solution images; only admin can upload
--   * security: helper functions not callable without login
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
create or replace trigger questions_status_stamp before insert or update on public.questions for each row execute function public.questions_status_stamp();

-- ---------- students see only published (policy created in V1, changed here) ----------
alter policy "questions: students read active" on public.questions using ((is_active and status = 'published') or public.is_admin());

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
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'solution images: admin writes') then
      execute $p$create policy "solution images: admin writes" on storage.objects for all to authenticated
        using (bucket_id = 'solution-images' and public.is_admin())
        with check (bucket_id = 'solution-images' and public.is_admin())$p$;
    end if;
  end if;
end $$;

-- ---------- security: no anonymous calls to helper functions ----------
revoke execute on function public.is_admin() from anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.questions_status_stamp() from public, anon, authenticated;
