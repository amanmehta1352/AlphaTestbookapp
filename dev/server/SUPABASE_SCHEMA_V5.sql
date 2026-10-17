-- =====================================================================
-- Master TestBook — Schema V5: CEO Command Center                2026-10-17
-- Adds (no DROP / DELETE anywhere — the connector cancels those):
--   ops_tasks          Central Task Manager (ASK/PLAN/EXECUTE commands, steps, checkpoints, logs, approval, report)
--   ops_events         privacy-safe feature-usage events from the app (aggregate dashboards only; 400/day/user)
--   admins.role        owner / admin / operator / readonly  + ops_perm(), ops_role(), ops_admin_list(), ops_set_role()
--   import_batches     + source_url, report (per-batch reconciliation from the PYQ Robot)
--   permission checks  inside the ops_* functions (re-created, same signatures)
-- Apply after V4.
-- =====================================================================

-- ---------------------------------------------------------------- roles & permissions
alter table public.admins add column if not exists role text not null default 'owner';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_check') then
    alter table public.admins add constraint admins_role_check check (role in ('owner', 'admin', 'operator', 'readonly'));
  end if;
end $c$;

create or replace function public.ops_role() returns text language sql stable security definer set search_path = public as $$
  select case when public.ops_is_service() then 'owner' else (select a.role from public.admins a where a.user_id = auth.uid()) end
$$;
-- permissions: read · plan · run (robots, backups, tasks) · edit (questions) · publish · settings · restore (restore/rollback) · roles
create or replace function public.ops_perm(p text) returns boolean language sql stable security definer set search_path = public as $$
  select case coalesce(public.ops_role(), '')
    when 'owner' then true
    when 'admin' then p in ('read', 'plan', 'run', 'edit', 'publish', 'settings')
    when 'operator' then p in ('read', 'plan', 'run')
    when 'readonly' then p in ('read')
    else false end
$$;
create or replace function public.ops_need(p text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ops_perm(p) then raise exception 'permission "%" needed (role: %)', p, coalesce(public.ops_role(), 'none') using errcode = '42501'; end if;
end $$;

create or replace function public.ops_admin_list() returns table(user_id uuid, email text, role text, added_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.ops_need('read');
  return query select a.user_id, u.email::text, a.role, a.added_at from public.admins a left join auth.users u on u.id = a.user_id order by a.added_at;
end $$;

-- owner only: add a person (must have logged in once) as admin with a role, or change a role
create or replace function public.ops_set_role(p_email text, p_role text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; owners int;
begin
  perform public.ops_need('roles');
  if p_role not in ('owner', 'admin', 'operator', 'readonly') then raise exception 'role must be owner/admin/operator/readonly'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'यह email अभी तक ऐप में login नहीं हुआ'; end if;
  if p_role <> 'owner' and exists (select 1 from public.admins where user_id = uid and role = 'owner') then
    select count(*) into owners from public.admins where role = 'owner';
    if owners <= 1 then raise exception 'आख़िरी owner की भूमिका नहीं बदल सकते'; end if;
  end if;
  insert into public.admins(user_id, role) values (uid, p_role) on conflict (user_id) do update set role = excluded.role;
  insert into public.ops_audit(table_name, row_id, action, actor, reason, changed) values ('admins', p_email, 'UPDATE', public.ops_actor(), 'role change', jsonb_build_object('role', jsonb_build_array(null, p_role)));
  return p_email || ' → ' || p_role;
end $$;

-- ---------------------------------------------------------------- permission checks inside V4 functions
create or replace function public.ops_can() returns boolean language sql stable security definer set search_path = public as $$
  select public.ops_is_service() or (public.is_admin() and public.ops_perm('read'))
$$;

create or replace function public.ops_question_action(p_ids text[], p_action text, p_reason text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.ops_need(case when p_action = 'publish' then 'publish' else 'edit' end);
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then raise exception '1-500 ids'; end if;
  perform set_config('ops.reason', coalesce(nullif(p_reason, ''), p_action), true);
  if p_action = 'publish' then
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

-- re-created with role checks (bodies unchanged from V4)
create or replace function public.ops_revert(p_audit_id bigint, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a public.ops_audit; cur jsonb; k text; cols text;
begin
  if not public.ops_is_service() then perform public.ops_need('edit'); end if;
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

create or replace function public.ops_backup_now(p_kind text default 'manual', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, backup as $$
declare d jsonb; c jsonb; sid bigint; keep int;
begin
  if not public.ops_is_service() then perform public.ops_need('run'); end if;
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

create or replace function public.ops_restore_questions(p_id bigint, p_confirm text, p_only_ids text[] default null) returns jsonb
language plpgsql security definer set search_path = public, backup as $$
declare s backup.snapshots; cols text; ex text; ups int; hid int := 0; safety jsonb;
begin
  if not public.ops_is_service() then perform public.ops_need('restore'); end if;
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

-- settings + question writes by RLS also need the matching permission
alter policy "ops_settings: admin writes" on public.ops_settings using (public.is_admin() and public.ops_perm('settings')) with check (public.is_admin() and public.ops_perm('settings'));
alter policy "questions: admin writes" on public.questions using (public.is_admin() and public.ops_perm('edit')) with check (public.is_admin() and public.ops_perm('edit'));

-- ---------------------------------------------------------------- Task Manager
create table if not exists public.ops_tasks (
  id bigserial primary key,
  title text not null check (length(title) <= 200),
  command text check (length(command) <= 2000),
  intent text,
  mode text not null default 'execute' check (mode in ('ask', 'plan', 'execute')),
  module text,
  priority smallint not null default 3 check (priority between 1 and 5),
  status text not null default 'queued' check (status in ('planned', 'queued', 'running', 'waiting_approval', 'paused', 'failed', 'completed', 'cancelled')),
  risk text not null default 'low' check (risk in ('low', 'medium', 'high')),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 30),
  current_step int not null default 0,
  checkpoint jsonb,
  logs jsonb not null default '[]'::jsonb,
  retry_count int not null default 0,
  approval jsonb,
  verification jsonb,
  report text check (length(report) <= 8000),
  dedupe_key text,
  parent_id bigint references public.ops_tasks(id),
  created_by text default public.ops_actor(),
  created_at timestamptz not null default now(),
  started_at timestamptz, updated_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists ops_tasks_status on public.ops_tasks (status, priority, id);
create unique index if not exists ops_tasks_dedupe on public.ops_tasks (dedupe_key) where status in ('queued', 'running', 'waiting_approval', 'paused');
alter table public.ops_tasks enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'ops_tasks' and policyname = 'ops_tasks: admin reads') then
    create policy "ops_tasks: admin reads" on public.ops_tasks for select to authenticated using (public.is_admin());
  end if;
end $p$;
grant select on public.ops_tasks to authenticated;

-- create a task (plan = nothing changes; execute = robots carry it out; high risk waits for owner approval)
create or replace function public.ops_task_create(p_title text, p_command text, p_intent text, p_mode text, p_module text, p_steps jsonb,
                                                  p_risk text default 'low', p_priority int default 3, p_dedupe text default null, p_parent bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint; st text;
begin
  perform public.ops_need(case when p_mode = 'execute' then 'run' else 'plan' end);
  if p_mode = 'execute' and p_risk = 'high' then st := 'waiting_approval';
  elsif p_mode = 'execute' then st := 'queued'; else st := 'planned'; end if;
  if p_dedupe is not null and exists (select 1 from public.ops_tasks where dedupe_key = p_dedupe and status in ('queued', 'running', 'waiting_approval', 'paused')) then
    select id into tid from public.ops_tasks where dedupe_key = p_dedupe and status in ('queued', 'running', 'waiting_approval', 'paused') order by id desc limit 1;
    return -tid;   -- negative = an identical task is already active
  end if;
  insert into public.ops_tasks(title, command, intent, mode, module, steps, risk, priority, status, dedupe_key, parent_id, logs)
  values (left(p_title, 200), left(p_command, 2000), p_intent, p_mode, p_module, coalesce(p_steps, '[]'::jsonb), coalesce(p_risk, 'low'), greatest(1, least(5, coalesce(p_priority, 3))), st, p_dedupe, p_parent,
          jsonb_build_array(jsonb_build_object('at', now(), 'msg', 'बनाया: ' || st, 'by', public.ops_actor())))
  returning id into tid;
  return tid;
end $$;

-- admin controls on a task: approve / reject / pause / resume / cancel / retry
create or replace function public.ops_task_control(p_id bigint, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare t public.ops_tasks; ns text;
begin
  select * into t from public.ops_tasks where id = p_id for update;
  if t.id is null then raise exception 'task % not found', p_id; end if;
  if p_action = 'approve' then
    perform public.ops_need(case when t.risk = 'high' then 'restore' else 'run' end);
    if t.status not in ('waiting_approval', 'planned') then raise exception 'task is %', t.status; end if;
    ns := 'queued';
    update public.ops_tasks set mode = 'execute', approval = jsonb_build_object('by', public.ops_actor(), 'at', now(), 'note', p_note) where id = p_id;
  elsif p_action = 'reject' then perform public.ops_need('run'); ns := 'cancelled';
  elsif p_action = 'pause' then perform public.ops_need('run'); if t.status not in ('queued', 'running') then raise exception 'task is %', t.status; end if; ns := 'paused';
  elsif p_action = 'resume' then perform public.ops_need('run'); if t.status <> 'paused' then raise exception 'task is %', t.status; end if; ns := 'queued';
  elsif p_action = 'cancel' then perform public.ops_need('run'); if t.status in ('completed', 'cancelled') then raise exception 'task is %', t.status; end if; ns := 'cancelled';
  elsif p_action = 'retry' then
    perform public.ops_need('run'); if t.status not in ('failed', 'cancelled') then raise exception 'task is %', t.status; end if; ns := 'queued';
    update public.ops_tasks set retry_count = retry_count + 1,
      steps = (select coalesce(jsonb_agg(case when s ->> 'status' in ('failed', 'running', 'cancelled') then s - 'status' - 'run_id' - 'error' else s end order by o), '[]'::jsonb) from jsonb_array_elements(t.steps) with ordinality e(s, o))
    where id = p_id;
  else raise exception 'unknown action %', p_action; end if;
  update public.ops_tasks set status = ns, updated_at = now(), finished_at = case when ns in ('cancelled') then now() else finished_at end,
    logs = logs || jsonb_build_array(jsonb_build_object('at', now(), 'msg', p_action || coalesce(': ' || p_note, ''), 'by', public.ops_actor()))
  where id = p_id;
  return ns;
end $$;

-- ---------------------------------------------------------------- feature-usage events (aggregate only)
create table if not exists public.ops_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  name text not null check (name ~ '^[a-z0-9_.:-]{2,60}$'),
  page text check (length(page) <= 60),
  ms integer check (ms >= 0 and ms <= 86400000),
  props jsonb check (length(props::text) <= 300)
);
create index if not exists ops_events_at on public.ops_events (at desc);
create index if not exists ops_events_name on public.ops_events (name, at desc);
alter table public.ops_events enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'ops_events' and policyname = 'ops_events: add own') then
    create policy "ops_events: add own" on public.ops_events for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ops_events' and policyname = 'ops_events: admin reads') then
    create policy "ops_events: admin reads" on public.ops_events for select to authenticated using (public.is_admin());
  end if;
end $p$;
grant select, insert on public.ops_events to authenticated; grant usage on sequence public.ops_events_id_seq to authenticated;
create or replace function public.ops_events_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ops_events where user_id = new.user_id and at > now() - interval '1 day') >= 400 then return null; end if;
  return new;
end $$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ops_events_limit') then
    create trigger ops_events_limit before insert on public.ops_events for each row execute function public.ops_events_limit();
  end if;
end $t$;

-- aggregate usage for the Control Room / Health Robot (no user ids leave this function)
create or replace function public.ops_usage_stats(p_days int default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(90, p_days)));
begin
  if not public.ops_can() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', p_days,
    'events', (select coalesce(jsonb_object_agg(name, jsonb_build_object('count', c, 'users', u)), '{}') from (select name, count(*) c, count(distinct user_id) u from public.ops_events where at >= since group by name) x),
    'pages', (select coalesce(jsonb_object_agg(page, jsonb_build_object('views', c, 'users', u, 'avg_ms', ms)), '{}') from (select page, count(*) c, count(distinct user_id) u, round(avg(ms)) ms from public.ops_events where at >= since and name = 'view' and page is not null group by page) x),
    'funnel_test', jsonb_build_object(
       'started', (select count(*) from public.ops_events where at >= since and name = 'test:start'),
       'submitted', (select count(*) from public.ops_events where at >= since and name = 'test:submit'),
       'results', (select count(*) from public.results where submitted_at >= since)),
    'cohorts', jsonb_build_object(
       'new_users', (select count(distinct e.user_id) from public.ops_events e join public.profiles p on p.id = e.user_id where e.at >= since and p.created_at >= since),
       'returning_users', (select count(distinct e.user_id) from public.ops_events e join public.profiles p on p.id = e.user_id where e.at >= since and p.created_at < since)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'events', c, 'users', u) order by d), '[]') from (select at::date d, count(*) c, count(distinct user_id) u from public.ops_events where at >= since group by 1) x),
    'inactive_users', (select count(*) from public.profiles p where not exists (select 1 from public.attempts a where a.user_id = p.id and a.answered_at >= now() - interval '14 days')
                         and not exists (select 1 from public.ops_events e where e.user_id = p.id and e.at >= now() - interval '14 days'))
  );
end $$;

-- ---------------------------------------------------------------- import batch reconciliation
alter table public.import_batches add column if not exists source_url text;
alter table public.import_batches add column if not exists report jsonb;

-- ---------------------------------------------------------------- grants
revoke execute on function public.ops_role(), public.ops_perm(text), public.ops_need(text), public.ops_admin_list(), public.ops_set_role(text, text),
  public.ops_task_create(text, text, text, text, text, jsonb, text, int, text, bigint), public.ops_task_control(bigint, text, text), public.ops_usage_stats(int) from public, anon;
grant execute on function public.ops_role(), public.ops_perm(text), public.ops_need(text), public.ops_admin_list(), public.ops_set_role(text, text),
  public.ops_task_create(text, text, text, text, text, jsonb, text, int, text, bigint), public.ops_task_control(bigint, text, text), public.ops_usage_stats(int) to authenticated;
revoke execute on function public.ops_events_limit() from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ops_role(), public.ops_perm(text), public.ops_need(text), public.ops_admin_list(), public.ops_set_role(text, text),
      public.ops_task_create(text, text, text, text, text, jsonb, text, int, text, bigint), public.ops_task_control(bigint, text, text), public.ops_usage_stats(int) to service_role';
    execute 'grant select, insert, update on public.ops_tasks, public.ops_events to service_role';
    execute 'grant usage on all sequences in schema public to service_role';
  end if;
end $g$;

-- ---------------------------------------------------------------- V5 seed settings (applied live 2026-10-17)
insert into public.ops_settings(key, value, is_public, label, note) values
  ('ops.lease',            '{"until":"2000-01-01T00:00:00Z","by":"init"}', false, 'Ops worker lease (internal)', 'एक समय में एक ही worker tasks चलाए'),
  ('retry.auto',           'true',  false, 'Fail पर अपने-आप 1 बार retry', 'health / backup / key-check / tests'),
  ('retry.max',            '1',     false, 'Auto-retry कितनी बार', null),
  ('robot.ops.enabled',    'true',  false, '⚙️ Ops Robot चालू', null),
  ('robot.design.enabled', 'true',  false, '🎨 Design Audit चालू', null),
  ('finance.assumptions',  '{"price":99,"conversion":3,"fee_pct":2,"gst_pct":18,"refund_pct":1,"fixed_monthly":0,"ai_per_user":0,"infra_per_user":0}', false, '💰 Finance मान्यताएँ (अनुमान)', 'Control Room → Finance')
on conflict (key) do nothing;
