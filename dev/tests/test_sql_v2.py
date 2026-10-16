"""SQL v2 on top of V1 with existing data: idempotent, existing stay published, RLS hides drafts, stamps, storage policy."""
import sys, fake_supabase as F
res = []
def rec(n, ok, d=''): res.append(ok); print('PASS' if ok else 'FAIL', n, str(d)[:200])
A, S = F.ADMIN[0], F.STUDENT[0]
F.start(F.SCHEMA_V1)
P = F.psql_raw
try:
    P("""insert into public.exams(id,name) values ('ssc-cgl','SSC CGL');
    insert into public.topics(id,subject,chapter,title) values ('t1','maths','Arithmetic','T1');
    insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer)
      select 'QQ'||g,'t1','maths','Arithmetic','T1','q'||g,'[{"letter":"A"},{"letter":"B"},{"letter":"C"},{"letter":"D"}]','A' from generate_series(1,5) g;
    insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer,is_active)
      values ('QQH','t1','maths','Arithmetic','T1','hidden','[{"letter":"A"},{"letter":"B"},{"letter":"C"},{"letter":"D"}]','A',false);""")
    v2 = open(F.SCHEMA_V2).read()
    P(v2); P(v2)
    rec('V2 runs twice without error', True)
    rec('existing questions became published', P("select count(*) from public.questions where status='published' and published_at is not null") == '6')
    P("insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer,status) values ('DD1','t1','maths','Arithmetic','T1','draft q','[{\"letter\":\"A\"},{\"letter\":\"B\"},{\"letter\":\"C\"},{\"letter\":\"D\"}]','A','draft'),('RR1','t1','maths','Arithmetic','T1','rev q','[{\"letter\":\"A\"},{\"letter\":\"B\"},{\"letter\":\"C\"},{\"letter\":\"D\"}]','A','reviewed')")
    student = P(F.as_user(S, "select string_agg(id, ',' order by id) from public.questions")).splitlines()[-1]
    rec('student sees only active published', student == 'QQ1,QQ2,QQ3,QQ4,QQ5', student)
    admin = P(F.as_user(A, "select count(*) from public.questions")).splitlines()[-1]
    rec('admin sees all incl. draft/reviewed/hidden', admin == '8', admin)
    rec('reviewed stamped on insert', P("select reviewed_at is not null and published_at is null from public.questions where id='RR1'") == 't')
    P(F.as_user(A, "update public.questions set status='published' where id='DD1'"))
    rec('publish stamps published_at + reviewed_at', P("select published_at is not null and reviewed_at is not null from public.questions where id='DD1'") == 't')
    rec('student now sees D1', 'DD1' in P(F.as_user(S, "select string_agg(id, ',') from public.questions")))
    try: P("update public.questions set status='live' where id='QQ1'"); ok = False
    except RuntimeError: ok = True
    rec('bad status rejected', ok)
    try: P(F.as_user(S, "update public.questions set status='draft' where id='QQ1'")); ok = P("select status from public.questions where id='QQ1'") == 'published'
    except RuntimeError: ok = True
    rec('student cannot change status', ok)
    P(F.as_user(A, "update public.questions set solution='{\"answer_line\":\"A\"}'::jsonb, solution_status='draft' where id='QQ1'"))
    rec('admin can write solution', P("select solution->>'answer_line' from public.questions where id='QQ1'") == 'A')
    try: P("update public.questions set solution='[1]'::jsonb where id='QQ2'"); ok = False
    except RuntimeError: ok = True
    rec('solution must be an object', ok)
    rec('bucket created public', P("select public from storage.buckets where id='solution-images'") == 't')
    P(F.as_user(A, "insert into storage.objects(bucket_id,name) values ('solution-images','QQ1.png')"))
    try: P(F.as_user(S, "insert into storage.objects(bucket_id,name) values ('solution-images','x.png')")); ok = False
    except RuntimeError: ok = True
    rec('only admin uploads images', ok)
    # old app upload path (no status column sent) still publishes
    P(F.as_user(A, "insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer) values ('OLDQ','t1','maths','Arithmetic','T1','old app','[{\"letter\":\"A\"},{\"letter\":\"B\"},{\"letter\":\"C\"},{\"letter\":\"D\"}]','A') on conflict (id) do update set question_en=excluded.question_en"))
    rec('old-app upload defaults to published', P("select status from public.questions where id='OLDQ'") == 'published')
    P(F.as_user(A, "insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer) values ('DD1','t1','maths','Arithmetic','T1','edited','[{\"letter\":\"A\"},{\"letter\":\"B\"},{\"letter\":\"C\"},{\"letter\":\"D\"}]','A') on conflict (id) do update set question_en=excluded.question_en"))
    rec('re-upload keeps status', P("select status||':'||question_en from public.questions where id='DD1'") == 'published:edited')
finally:
    F.stop()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
