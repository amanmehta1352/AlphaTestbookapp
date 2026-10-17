-- =====================================================================
-- Master TestBook — Schema V4: Control Room (ops)            2026-10-17
-- Adds (nothing existing is dropped or changed in meaning):
--   ops_settings      flags + policies (pause robots, freeze data, maintenance, thresholds)
--   ops_requests      admin "run / cancel / backup / rollback" queue, executed by the Ops Robot (GitHub)
--   ops_audit         every change to questions/topics/settings with before→after, actor, reason (+ ops_revert)
--   ops_incidents     alerts opened/closed by the Health Robot
--   ops_runs          robot run statistics (processed / changed)
--   ops_client_errors JS errors reported by the student app (rate-limited)
--   backup.snapshots  full JSON snapshots (content + student data), verify + restore functions
--   ops_db_stats()    sizes, counts, integrity, performance for the Control Room
-- Apply after V1-V3. Safe to re-run (IF NOT EXISTS / OR REPLACE).
-- =====================================================================
create schema if not exists backup;

-- who is calling: service key (robots), SQL console, or a signed-in admin
create or replace function public.ops_is_service() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or coalesce(current_setting('role', true), '') = 'service_role'
      or (session_user in ('postgres', 'supabase_admin') and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres', 'supabase_admin'))
$$;
create or replace function public.ops_can() returns boolean language sql stable security definer set search_path = public as $$
  select public.ops_is_service() or public.is_admin()
$$;
create or replace function public.ops_actor() returns text language plpgsql stable security definer set search_path = public, auth as $$
declare h jsonb; who text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  who := nullif(h ->> 'x-actor', '');
  if who is null and auth.uid() is not null then select coalesce(u.email, auth.uid()::text) into who from auth.users u where u.id = auth.uid(); end if;
  if who is null and public.ops_is_service() then who := 'robot (service key)'; end if;
  return coalesce(who, session_user::text);
end $$;

-- ---------------------------------------------------------------- settings
create table if not exists public.ops_settings (
  key text primary key check (key ~ '^[a-z0-9_.-]{2,60}$'),
  value jsonb not null,
  is_public boolean not null default false,
  label text, note text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.ops_settings enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_settings' and policyname = 'ops_settings: anon public') then
  execute 'create policy "ops_settings: anon public" on public.ops_settings for select to anon using (is_public)';
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_settings' and policyname = 'ops_settings: read') then
  execute 'create policy "ops_settings: read" on public.ops_settings for select to authenticated using (is_public or public.is_admin())';
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_settings' and policyname = 'ops_settings: admin writes') then
  execute 'create policy "ops_settings: admin writes" on public.ops_settings for update to authenticated using (public.is_admin()) with check (public.is_admin())';
end if; end $p$;
grant select on public.ops_settings to anon, authenticated; grant update on public.ops_settings to authenticated;

insert into public.ops_settings(key, value, is_public, label, note) values
  ('robots.paused',          'false', false, 'सारे robots रोको (Global pause)', 'true = कोई robot server नहीं बदलेगा; Tests/Health चलते रहेंगे'),
  ('data.frozen',            'false', false, 'Data बदलना बंद (Freeze)', 'true = PYQ/Hindi/Tag robots server पर कुछ नहीं लिखेंगे'),
  ('publish.auto',           'false', false, 'Auto-publish', 'false = हर publish इंसान करेगा'),
  ('robot.pyq.enabled',      'true',  false, '🤖 PYQ Robot चालू', null),
  ('robot.hindi.enabled',    'true',  false, '🌐 Hindi Robot चालू', null),
  ('robot.tag.enabled',      'true',  false, '🏷️ Tag Robot चालू', null),
  ('robot.keycheck.enabled', 'true',  false, '🔑 Key-check Robot चालू', null),
  ('robot.backup.enabled',   'true',  false, '💾 Backup Robot चालू', null),
  ('robot.health.enabled',   'true',  false, '🩺 Health Robot चालू', null),
  ('maintenance',            '{"on": false, "message": ""}', true, 'Maintenance mode', 'on = ऐप में ऊपर संदेश दिखेगा'),
  ('tag.min_prob',           '0.55',  false, 'Tag Robot: कम से कम भरोसा', '0.5–0.95'),
  ('tag.min_cv',             '0.80',  false, 'Tag Robot: subject की कम से कम सटीकता', '0.6–0.99'),
  ('keycheck.gemini_limit',  '150',   false, 'Key-check: Gemini सवाल प्रति run', 'free सीमा'),
  ('backup.keep',            '14',    false, 'कितने backup रखें', '3–60'),
  ('alerts.issue',           'true',  false, 'लाल होने पर GitHub issue', null),
  ('quality.min_text',       '8',     false, 'सवाल का कम से कम text (अक्षर)', 'इससे छोटा = टूटा')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- audit
create table if not exists public.ops_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'REVERT', 'NOTE')),
  actor text,
  reason text,
  changed jsonb not null default '{}'::jsonb
);
create index if not exists ops_audit_row on public.ops_audit (table_name, row_id, id desc);
create index if not exists ops_audit_at on public.ops_audit (at desc);
alter table public.ops_audit enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_audit' and policyname = 'ops_audit: admin reads') then
  execute 'create policy "ops_audit: admin reads" on public.ops_audit for select to authenticated using (public.is_admin())';
end if; end $p$;
grant select on public.ops_audit to authenticated;

create or replace function public.ops_audit_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; ch jsonb := '{}'::jsonb; k text; rid text;
begin
  if tg_op = 'DELETE' then
    o := to_jsonb(old); rid := coalesce(o ->> 'id', o ->> 'key');
    insert into public.ops_audit(table_name, row_id, action, actor, reason, changed) values (tg_table_name, rid, 'DELETE', public.ops_actor(), nullif(current_setting('ops.reason', true), ''), jsonb_build_object('old', o));
    return old;
  end if;
  n := to_jsonb(new); rid := coalesce(n ->> 'id', n ->> 'key');
  if tg_op = 'INSERT' then
    ch := jsonb_strip_nulls(jsonb_build_object('status', n -> 'status', 'is_active', n -> 'is_active', 'source_ref', n -> 'source_ref', 'value', n -> 'value'));
  else
    o := to_jsonb(old);
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'content_hash', 'reviewed_at', 'published_at') and (o -> k) is distinct from (n -> k) then
        ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if ch = '{}'::jsonb then return new; end if;
  end if;
  insert into public.ops_audit(table_name, row_id, action, actor, reason, changed)
  values (tg_table_name, rid, case when nullif(current_setting('ops.reverting', true), '') is not null then 'REVERT' else tg_op end,
          public.ops_actor(), nullif(current_setting('ops.reason', true), ''), ch);
  return new;
end $$;

do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'ops_audit_questions' and tgrelid = 'public.questions'::regclass) then
  create trigger ops_audit_questions after insert or update or delete on public.questions for each row execute function public.ops_audit_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'ops_audit_topics' and tgrelid = 'public.topics'::regclass) then
  create trigger ops_audit_topics after insert or update or delete on public.topics for each row execute function public.ops_audit_trg();
end if; end $t$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'ops_audit_settings' and tgrelid = 'public.ops_settings'::regclass) then
  create trigger ops_audit_settings after update on public.ops_settings for each row execute function public.ops_audit_trg();
end if; end $t$;

create or replace function public.ops_settings_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := public.ops_actor(); return new; end $$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'ops_settings_touch' and tgrelid = 'public.ops_settings'::regclass) then
  create trigger ops_settings_touch before update on public.ops_settings for each row execute function public.ops_settings_touch();
end if; end $t$;

-- Undo one audited change on a question (admin / service). Never deletes: an undone INSERT hides the question.
create or replace function public.ops_revert(p_audit_id bigint, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a public.ops_audit; cur jsonb; k text; cols text;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into a from public.ops_audit where id = p_audit_id;
  if a.id is null then raise exception 'audit % not found', p_audit_id; end if;
  if a.table_name <> 'questions' then raise exception 'only question changes can be undone here'; end if;
  perform set_config('ops.reason', coalesce(p_reason, 'undo of change #' || a.id), true);
  perform set_config('ops.reverting', '1', true);
  if a.action = 'DELETE' then
    insert into public.questions select * from jsonb_populate_record(null::public.questions, a.changed -> 'old') on conflict (id) do nothing;
    return 'restored deleted question ' || a.row_id;
  elsif a.action = 'INSERT' then
    update public.questions set is_active = false where id = a.row_id;
    return 'hid question ' || a.row_id;
  elsif a.action in ('UPDATE', 'REVERT') then
    select to_jsonb(q) into cur from public.questions q where q.id = a.row_id;
    if cur is null then raise exception 'question % no longer exists', a.row_id; end if;
    for k in select jsonb_object_keys(a.changed) loop cur := jsonb_set(cur, array[k], a.changed -> k -> 0); end loop;
    cur := jsonb_set(cur, '{content_hash}', to_jsonb('rv-' || substr(md5(cur::text), 1, 18)));
    select string_agg(quote_ident(x), ',') into cols from (select jsonb_object_keys(a.changed) x union select 'content_hash') s;
    execute format('update public.questions set (%s) = (select %s from jsonb_populate_record(null::public.questions, $1)) where id = $2', cols, cols) using cur, a.row_id;
    return 'undid ' || (select count(*) from jsonb_object_keys(a.changed)) || ' field(s) on ' || a.row_id;
  end if;
  raise exception 'cannot undo action %', a.action;
end $$;

-- Admin bulk action on questions with a recorded reason (approve/publish/hide/reject/draft)
create or replace function public.ops_question_action(p_ids text[], p_action text, p_reason text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then raise exception '1-500 ids'; end if;
  perform set_config('ops.reason', coalesce(nullif(p_reason, ''), p_action), true);
  if p_action = 'publish' then
    -- quality gate: only complete questions go live
    update public.questions set status = 'published', is_active = true, published_at = now(), reviewed_at = coalesce(reviewed_at, now()),
      content_hash = 'pb-' || substr(md5(id || now()::text), 1, 18)
    where id = any(p_ids) and answer in ('A','B','C','D') and jsonb_array_length(coalesce(options, '[]'::jsonb)) = 4
      and length(coalesce(nullif(question_en, ''), question_hi, '')) >= 8
      and not exists (select 1 from jsonb_array_elements(options) o where coalesce(nullif(o ->> 'en', ''), o ->> 'hi', '') = '');
  elsif p_action = 'approve' then update public.questions set status = 'reviewed', reviewed_at = now() where id = any(p_ids) and status = 'draft';
  elsif p_action = 'draft' then update public.questions set status = 'draft' where id = any(p_ids);
  elsif p_action in ('hide', 'reject') then update public.questions set is_active = false, content_hash = 'hd-' || substr(md5(id || now()::text), 1, 18) where id = any(p_ids);
  elsif p_action = 'unhide' then update public.questions set is_active = true, content_hash = 'uh-' || substr(md5(id || now()::text), 1, 18) where id = any(p_ids);
  else raise exception 'unknown action %', p_action; end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- requests (Control Room → Ops Robot)
create table if not exists public.ops_requests (
  id bigserial primary key,
  action text not null check (action in ('run', 'cancel', 'backup', 'rollback', 'verify_backup')),
  target text not null default '' check (length(target) <= 80),
  params jsonb not null default '{}'::jsonb check (length(params::text) <= 4000),
  status text not null default 'queued' check (status in ('queued', 'sent', 'done', 'failed', 'rejected')),
  requested_by text default public.ops_actor(),
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  result text
);
alter table public.ops_requests enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_requests' and policyname = 'ops_requests: admin') then
  execute 'create policy "ops_requests: admin" on public.ops_requests for select to authenticated using (public.is_admin())';
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_requests' and policyname = 'ops_requests: admin adds') then
  execute 'create policy "ops_requests: admin adds" on public.ops_requests for insert to authenticated with check (public.is_admin() and status = ''queued'')';
end if; end $p$;
grant select, insert on public.ops_requests to authenticated; grant usage on sequence public.ops_requests_id_seq to authenticated;

-- ---------------------------------------------------------------- incidents, runs, client errors
create table if not exists public.ops_incidents (
  id bigserial primary key,
  key text not null,
  severity text not null check (severity in ('critical', 'major', 'minor')),
  area text, title text not null, detail text, suggestion text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  opened_at timestamptz not null default now(), last_seen timestamptz not null default now(), resolved_at timestamptz, seen_count integer not null default 1
);
create unique index if not exists ops_incidents_open_key on public.ops_incidents (key) where status = 'open';
alter table public.ops_incidents enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_incidents' and policyname = 'ops_incidents: admin') then
  execute 'create policy "ops_incidents: admin" on public.ops_incidents for select to authenticated using (public.is_admin())';
end if; end $p$;
grant select on public.ops_incidents to authenticated;

create table if not exists public.ops_runs (
  id bigserial primary key,
  robot text not null, run_id text, started_at timestamptz default now(), finished_at timestamptz,
  ok boolean, processed integer, changed integer, note text check (length(note) <= 1000)
);
create index if not exists ops_runs_robot on public.ops_runs (robot, id desc);
alter table public.ops_runs enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_runs' and policyname = 'ops_runs: admin') then
  execute 'create policy "ops_runs: admin" on public.ops_runs for select to authenticated using (public.is_admin())';
end if; end $p$;
grant select on public.ops_runs to authenticated;

create table if not exists public.ops_client_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  app_version text check (length(app_version) <= 40),
  page text check (length(page) <= 80),
  message text not null check (length(message) <= 500),
  stack text check (length(stack) <= 2000)
);
create index if not exists ops_client_errors_at on public.ops_client_errors (at desc);
alter table public.ops_client_errors enable row level security;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_client_errors' and policyname = 'ops_client_errors: add own') then
  execute 'create policy "ops_client_errors: add own" on public.ops_client_errors for insert to authenticated with check (user_id = auth.uid())';
end if; end $p$;
do $p$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ops_client_errors' and policyname = 'ops_client_errors: admin reads') then
  execute 'create policy "ops_client_errors: admin reads" on public.ops_client_errors for select to authenticated using (public.is_admin())';
end if; end $p$;
grant select, insert on public.ops_client_errors to authenticated; grant usage on sequence public.ops_client_errors_id_seq to authenticated;
create or replace function public.ops_client_errors_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ops_client_errors where user_id = new.user_id and at > now() - interval '1 hour') >= 30 then return null; end if;
  return new;
end $$;
do $t$ begin if not exists (select 1 from pg_trigger where tgname = 'ops_client_errors_limit' and tgrelid = 'public.ops_client_errors'::regclass) then
  create trigger ops_client_errors_limit before insert on public.ops_client_errors for each row execute function public.ops_client_errors_limit();
end if; end $t$;

-- ---------------------------------------------------------------- backups
create table if not exists backup.snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  kind text not null default 'auto',
  note text,
  taken_by text,
  counts jsonb not null,
  checksum text not null,
  verified_at timestamptz, verify_result text,
  data jsonb not null
);
revoke all on backup.snapshots from anon, authenticated;

create or replace function public.ops_backup_now(p_kind text default 'manual', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, backup as $$
declare d jsonb; c jsonb; sid bigint; keep int;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  d := jsonb_build_object(
    'questions', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.questions x), '[]'),
    'topics', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.topics x), '[]'),
    'exams', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.exams x), '[]'),
    'profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.profiles x), '[]'),
    'attempts', coalesce((select jsonb_agg(to_jsonb(x)) from public.attempts x), '[]'),
    'results', coalesce((select jsonb_agg(to_jsonb(x)) from public.results x), '[]'),
    'bookmarks', coalesce((select jsonb_agg(to_jsonb(x)) from public.bookmarks x), '[]'),
    'review_cards', coalesce((select jsonb_agg(to_jsonb(x)) from public.review_cards x), '[]'),
    'admins', coalesce((select jsonb_agg(to_jsonb(x)) from public.admins x), '[]'),
    'ops_settings', coalesce((select jsonb_agg(to_jsonb(x)) from public.ops_settings x), '[]'));
  select jsonb_object_agg(k, jsonb_array_length(d -> k)) into c from jsonb_object_keys(d) k;
  insert into backup.snapshots(kind, note, taken_by, counts, checksum, data) values (coalesce(p_kind, 'manual'), p_note, public.ops_actor(), c, md5(d::text), d) returning id into sid;
  keep := greatest(3, least(60, coalesce((select (value #>> '{}')::int from public.ops_settings where key = 'backup.keep'), 14)));
  -- prune: old snapshots keep their row (history) but their data is emptied
  update backup.snapshots set data = '{}'::jsonb, checksum = 'pruned', kind = 'pruned'
   where kind not in ('pinned', 'pruned') and id not in (select id from backup.snapshots where kind not in ('pruned') order by id desc limit keep);
  return jsonb_build_object('id', sid, 'counts', c);
end $$;

create or replace function public.ops_backup_list() returns table(id bigint, taken_at timestamptz, kind text, note text, taken_by text, counts jsonb, size_kb integer, verified_at timestamptz, verify_result text)
language plpgsql security definer set search_path = public, backup as $$
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select s.id, s.taken_at, s.kind, s.note, s.taken_by, s.counts, (pg_column_size(s.data) / 1024)::int, s.verified_at, s.verify_result from backup.snapshots s where s.kind <> 'pruned' order by s.id desc;
end $$;

-- verify = checksum matches AND every table can be rebuilt from the JSON with the same row count (restore test)
create or replace function public.ops_backup_verify(p_id bigint) returns text
language plpgsql security definer set search_path = public, backup as $$
declare s backup.snapshots; ok boolean; n int; res text;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into s from backup.snapshots where id = p_id;
  if s.id is null then raise exception 'snapshot % not found', p_id; end if;
  ok := md5(s.data::text) = s.checksum;
  select count(*) into n from jsonb_populate_recordset(null::public.questions, s.data -> 'questions');
  ok := ok and n = (s.counts ->> 'questions')::int;
  select count(*) into n from jsonb_populate_recordset(null::public.topics, s.data -> 'topics');
  ok := ok and n = (s.counts ->> 'topics')::int;
  select count(*) into n from jsonb_populate_recordset(null::public.results, s.data -> 'results');
  ok := ok and n = (s.counts ->> 'results')::int;
  res := case when ok then 'ok' else 'FAILED' end;
  update backup.snapshots set verified_at = now(), verify_result = res where id = p_id;
  return res;
end $$;

-- restore questions (content only) from a snapshot. Takes a safety snapshot first. Never deletes: questions
-- that are not in the snapshot are hidden. Requires p_confirm = 'RESTORE-<id>'.
create or replace function public.ops_restore_questions(p_id bigint, p_confirm text, p_only_ids text[] default null) returns jsonb
language plpgsql security definer set search_path = public, backup as $$
declare s backup.snapshots; cols text; ex text; ups int; hid int := 0; safety jsonb;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_confirm is distinct from 'RESTORE-' || p_id then raise exception 'confirmation text must be RESTORE-%', p_id; end if;
  select * into s from backup.snapshots where id = p_id;
  if s.id is null then raise exception 'snapshot % not found', p_id; end if;
  if md5(s.data::text) <> s.checksum then raise exception 'snapshot % failed checksum — not restoring', p_id; end if;
  safety := public.ops_backup_now('pre-restore', 'before restore of #' || p_id);
  perform set_config('ops.reason', 'restore from backup #' || p_id, true);
  select string_agg(quote_ident(attname), ',' order by attnum), string_agg('excluded.' || quote_ident(attname), ',' order by attnum) into cols, ex
    from pg_attribute where attrelid = 'public.questions'::regclass and attnum > 0 and not attisdropped;
  execute format('insert into public.questions (%1$s) select %1$s from jsonb_populate_recordset(null::public.questions, $1) r where $2 is null or r.id = any($2)
    on conflict (id) do update set (%1$s) = row(%2$s)', cols, ex) using s.data -> 'questions', p_only_ids;
  get diagnostics ups = row_count;
  if p_only_ids is null then
    update public.questions q set is_active = false
    where q.is_active and not exists (select 1 from jsonb_array_elements(s.data -> 'questions') e where e ->> 'id' = q.id);
    get diagnostics hid = row_count;
  end if;
  update public.questions set content_hash = 'rs-' || substr(md5(id || now()::text), 1, 18)
  where p_only_ids is null or id = any(p_only_ids);
  return jsonb_build_object('restored', ups, 'hidden', hid, 'safety_snapshot', safety -> 'id');
end $$;

-- ---------------------------------------------------------------- stats for the Control Room / Health Robot
create or replace function public.ops_db_stats() returns jsonb
language plpgsql security definer set search_path = public, backup, storage, auth, extensions as $$
declare r jsonb; perf jsonb := null;
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  begin
    execute $q$select jsonb_build_object('calls', sum(calls)::bigint, 'mean_ms', round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 2),
      'slow', (select count(*) from pg_stat_statements where mean_exec_time > 200))
      from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())$q$ into perf;
  exception when others then perf := null; end;
  r := jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', (select jsonb_object_agg(c.relname, jsonb_build_object('rows', c.reltuples::bigint, 'bytes', pg_total_relation_size(c.oid)))
               from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = 'public'),
    'exact', jsonb_build_object('questions', (select count(*) from public.questions), 'topics', (select count(*) from public.topics),
               'attempts', (select count(*) from public.attempts), 'results', (select count(*) from public.results),
               'profiles', (select count(*) from public.profiles), 'bookmarks', (select count(*) from public.bookmarks)),
    'backup_bytes', (select coalesce(sum(pg_total_relation_size(c.oid)), 0) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = 'backup'),
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'storage_files', (select count(*) from storage.objects),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'integrity', jsonb_build_object(
       'orphan_questions', (select count(*) from public.questions q where not exists (select 1 from public.topics t where t.id = q.topic_id)),
       'duplicate_live', (select coalesce(sum(c - 1), 0) from (select count(*) c from public.questions where is_active and status = 'published'
                           group by lower(regexp_replace(coalesce(question_en, question_hi, ''), '\s+', ' ', 'g')), options::text having count(*) > 1) d),
       'orphan_attempts', (select count(*) from public.attempts a where not exists (select 1 from public.questions q where q.id = a.question_id)),
       'bad_answer', (select count(*) from public.questions where answer is null or answer not in ('A','B','C','D')),
       'no_explanation_live', (select count(*) from public.questions where is_active and status = 'published' and coalesce(nullif(explanation_en, ''), nullif(explanation_hi, ''), nullif(solution #>> '{}', ''), '') = '')),
    'auth', jsonb_build_object('users', (select count(*) from auth.users), 'new_24h', (select count(*) from auth.users where created_at > now() - interval '1 day'),
               'signins_24h', (select count(*) from auth.users where last_sign_in_at > now() - interval '1 day'), 'admins', (select count(*) from public.admins)),
    'audit_24h', (select count(*) from public.ops_audit where at > now() - interval '1 day'),
    'client_errors_24h', (select count(*) from public.ops_client_errors where at > now() - interval '1 day'),
    'backups', (select jsonb_build_object('count', count(*), 'last_at', max(taken_at), 'last_verified', max(verified_at) filter (where verify_result = 'ok')) from backup.snapshots where kind <> 'pruned'),
    'perf', perf);
  return r;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.ops_revert(bigint, text), public.ops_question_action(text[], text, text), public.ops_backup_now(text, text),
  public.ops_backup_list(), public.ops_backup_verify(bigint), public.ops_restore_questions(bigint, text, text[]), public.ops_db_stats(), public.ops_can(), public.ops_actor() from public, anon;
grant execute on function public.ops_revert(bigint, text), public.ops_question_action(text[], text, text), public.ops_backup_now(text, text),
  public.ops_backup_list(), public.ops_backup_verify(bigint), public.ops_restore_questions(bigint, text, text[]), public.ops_db_stats(), public.ops_can(), public.ops_actor() to authenticated;
revoke all on function public.ops_audit_trg(), public.ops_settings_touch(), public.ops_client_errors_limit() from public, anon, authenticated;
-- advisor fix: the event-trigger helper must not be callable through the API
do $$ begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ops_revert(bigint, text), public.ops_question_action(text[], text, text), public.ops_backup_now(text, text),
      public.ops_backup_list(), public.ops_backup_verify(bigint), public.ops_restore_questions(bigint, text, text[]), public.ops_db_stats(), public.ops_can(), public.ops_actor() to service_role';
    execute 'grant select, insert, update on public.ops_settings, public.ops_requests, public.ops_incidents, public.ops_runs to service_role';
    execute 'grant select on public.ops_audit, public.ops_client_errors to service_role';
    execute 'grant usage on all sequences in schema public to service_role';
  end if;
end $$;
