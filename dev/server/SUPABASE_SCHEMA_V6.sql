-- V6 (17 Oct 2026): PDF upload for PYQ import. Private bucket; only admins with 'run' permission can upload;
-- the Ops Robot (service key) makes a 1-hour signed link. No DROP/DELETE.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pyq-uploads', 'pyq-uploads', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pyq uploads: admin upload') then
    create policy "pyq uploads: admin upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'pyq-uploads' and public.ops_perm('run'));
  end if;
end $p$;
