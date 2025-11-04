begin;
-- presentations 버킷: rooms/<roomId>/... 경로에 대해 '방 소유자'만 쓰기
drop policy if exists presentations_owner_insert on storage.objects;
drop policy if exists presentations_owner_update on storage.objects;

create policy presentations_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'presentations'
  and exists (
    select 1
    from public.rooms r
    where r.id = (substring(name from '^rooms/([a-f0-9-]{36})/') )::uuid
      and r.owner_id = auth.uid()
  )
);

create policy presentations_owner_update
on storage.objects
for update
                                to authenticated
                                using (
                                bucket_id = 'presentations'
                                and exists (
                                select 1
                                from public.rooms r
                                where r.id = (substring(name from '^rooms/([a-f0-9-]{36})/') )::uuid
                                and r.owner_id = auth.uid()
                                )
                                )
    with check (
                                bucket_id = 'presentations'
                                and exists (
                                select 1
                                from public.rooms r
                                where r.id = (substring(name from '^rooms/([a-f0-9-]{36})/') )::uuid
                                and r.owner_id = auth.uid()
                                )
                                );
commit;
