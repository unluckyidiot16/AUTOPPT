-- 001_lobby_and_host_lock.sql

-- 1) RLS (소유자만 SELECT/UPDATE/DELETE, 인증 사용자는 INSERT)
alter table public.rooms enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='rooms' and policyname='rooms_owner_select') then
    create policy rooms_owner_select on public.rooms
      for select to authenticated
                               using (owner_id = auth.uid());
end if;

  if not exists (select 1 from pg_policies where tablename='rooms' and policyname='rooms_owner_update') then
    create policy rooms_owner_update on public.rooms
      for update to authenticated
                              using (owner_id = auth.uid())
          with check (owner_id = auth.uid());
end if;

  if not exists (select 1 from pg_policies where tablename='rooms' and policyname='rooms_owner_delete') then
    create policy rooms_owner_delete on public.rooms
      for delete to authenticated
      using (owner_id = auth.uid());
end if;

  if not exists (select 1 from pg_policies where tablename='rooms' and policyname='rooms_owner_insert') then
    create policy rooms_owner_insert on public.rooms
      for insert to authenticated
      with check (owner_id = auth.uid());
end if;
end $$;

-- 2) 방 코드 생성기
create or replace function public.generate_room_code(p_len int default 6)
returns text language plpgsql as $$
declare
chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  outc  text := '';
  i int;
begin
for i in 1..p_len loop
    outc := outc || substr(chars, 1+floor(random()*length(chars))::int, 1);
end loop;
return 'CLASS-'||outc;
end $$;

-- 3) 방 생성 RPC (로비에서만 사용) : code 중복 시 재시도
create or replace function public.create_room(p_title text default null)
returns table(id uuid, code text) language plpgsql security definer as $$
declare
v_code text;
  v_owner uuid := auth.uid();
  v_id uuid;
  tries int := 0;
begin
  if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;

  loop
tries := tries + 1;
    v_code := public.generate_room_code();
begin
insert into public.rooms(id, code, owner_id, title, is_open)
values (gen_random_uuid(), v_code, v_owner, coalesce(p_title, v_code), true)
    returning rooms.id, rooms.code into v_id, v_code;
exit; -- success
exception when unique_violation then
      if tries > 5 then raise; end if;
end;
end loop;

return query select v_id, v_code;
end $$;

-- 4) 내 방 목록 RPC (최신순)
create or replace function public.list_my_rooms()
returns table(id uuid, code text, title text, created_at timestamptz)
language sql security definer as $$
select r.id, r.code, coalesce(r.title, r.code) as title, r.created_at
from public.rooms r
where r.owner_id = auth.uid()
order by r.created_at desc
    $$;

-- 5) 호스트 잠금(한 명만 발표 권한) : ppt_sessions 사용
--    성공 시 현재 호스트가 됨, 이미 다른 호스트가 있으면 BUSY
create or replace function public.claim_host(p_room_code text)
returns boolean language plpgsql security definer as $$
declare
v_owner uuid := auth.uid();
  v_s record;
begin
  if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;

select * into v_s from public.ppt_sessions where id = p_room_code;
if not found then
    insert into public.ppt_sessions(id, slide, step, updated_at, host_key, host_since, owner_id)
    values (p_room_code, 1, 0, now(), 'host', now(), v_owner);
return true;
end if;

  if v_s.owner_id is null or v_s.owner_id = v_owner then
update public.ppt_sessions
set owner_id = v_owner, host_since = now(), updated_at = now()
where id = p_room_code;
return true;
end if;

  raise exception 'BUSY'; -- 다른 호스트가 보유중
end $$;

-- 6) 호스트 해제
create or replace function public.release_host(p_room_code text)
returns boolean language sql security definer as $$
update public.ppt_sessions
set owner_id = null, updated_at = now()
where id = p_room_code;
select true;
$$;

-- 7) 방 삭제(깊은 삭제) : 자식 레코드 정리 후 rooms 삭제
create or replace function public.delete_room_deep(p_room_id uuid)
returns boolean language plpgsql security definer as $$
declare
v_owner uuid := auth.uid();
  v_code text;
begin
  if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;
  -- 소유자 확인
  perform 1 from public.rooms r where r.id = p_room_id and r.owner_id = v_owner;
  if not found then raise exception 'FORBIDDEN'; end if;

  -- 코드 확보 (세션/프리젠스 정리용)
select code into v_code from public.rooms where id = p_room_id;

-- 자식 테이블(rooms FK 보유) 정리
delete from public.room_lessons where room_id = p_room_id;
delete from public.room_decks where room_id = p_room_id;
delete from public.room_deck_overrides where room_id = p_room_id;
delete from public.answers where room_id::uuid = p_room_id::uuid;
delete from public.answers_v2 where room_id = p_room_id;
delete from public.answer_logs where room_id = p_room_id;
delete from public.ppt_unlock_requests where room_id = v_code; -- 이 테이블은 text room_id 사용
delete from public.ppt_rooms where id = v_code;
delete from public.ppt_sessions where id = v_code;

-- 마지막 rooms 삭제
delete from public.rooms where id = p_room_id;

return true;
end $$;
