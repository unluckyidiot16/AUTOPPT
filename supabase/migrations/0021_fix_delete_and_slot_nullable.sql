-- 002_fix_delete_and_slot_nullable.sql

-- A) delete_room_deep: room 코드(v_code) 기준으로 안전 삭제
create or replace function public.delete_room_deep(p_room_id uuid)
returns boolean
language plpgsql security definer
as $$
declare
v_owner uuid := auth.uid();
  v_code  text;
begin
  if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 소유자 확인
  perform 1 from public.rooms r where r.id = p_room_id and r.owner_id = v_owner;
  if not found then raise exception 'FORBIDDEN'; end if;

  -- 방 코드 확보
select code into v_code from public.rooms where id = p_room_id;

-- 자식/연계 데이터 정리
delete from public.room_lessons         where room_id = p_room_id;
delete from public.room_decks           where room_id = p_room_id;
delete from public.room_deck_overrides  where room_id = p_room_id;
delete from public.answers_v2           where room_id = p_room_id;
delete from public.answer_logs          where room_id = p_room_id;

-- answers: 예전 스키마 혼재( room_id=text / room_code=text ) 안전 처리
delete from public.answers
where room_code = v_code
   or room_id   = v_code
   or (room_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and room_id::uuid = p_room_id);

-- ppt_*는 room_code(text) 사용
delete from public.ppt_unlock_requests where room_id = v_code;
delete from public.ppt_rooms          where id      = v_code;
delete from public.ppt_sessions       where id      = v_code;

-- 마지막 rooms 삭제
delete from public.rooms where id = p_room_id;

return true;
end $$;
