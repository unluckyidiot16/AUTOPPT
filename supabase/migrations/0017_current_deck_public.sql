-- 0017_current_deck_public.sql
-- 목적: 학생(익명/로그인 불문)이 현재 교시의 file_key를 받아올 수 있게 함
--      (security definer로 서버에서 조회 → RLS 우회)
begin;

drop function if exists public.get_current_deck_file_key_public(text);

create or replace function public.get_current_deck_file_key_public(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
v_room_id uuid;
  v_key     text;
begin
select id into v_room_id
from public.rooms
where code = p_code
    limit 1;

if v_room_id is null then
    return null;
end if;

select d.file_key into v_key
from public.rooms r
         join public.room_decks rd on rd.room_id = r.id
         join public.decks d       on d.id = rd.deck_id
where r.id = v_room_id
  and r.current_deck_id = rd.deck_id
    limit 1;

return v_key;
end $$;

-- 학생이 anon이어도 호출 가능해야 함
grant execute on function public.get_current_deck_file_key_public(text) to anon, authenticated;

commit;
