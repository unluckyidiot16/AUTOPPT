begin;

-- 기존 정책 제거(없으면 무시)
drop policy if exists presentations_owner_insert on storage.objects;
drop policy if exists presentations_owner_update on storage.objects;

-- rooms 테이블이 있을 때만 정책 생성 (없으면 스킵)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'rooms'
  ) then
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
else
    raise notice 'public.rooms not found — skipping presentations_* storage policies';
end if;
end $$;

commit;
