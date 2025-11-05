-- 0016_deck_file_access.sql
-- 목적: (1) 현재 교시의 file_key 안전 조회, (2) deck_id로 file_key 갱신

begin;

-- 충돌 방지
drop function if exists public.get_current_deck_file_key(text);
drop function if exists public.upsert_deck_file_by_id(uuid, text);

-- 1) 현재 교시의 file_key 반환 (owner 검증 + security definer)
create or replace function public.get_current_deck_file_key(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
v_room_id uuid;
  v_owner   uuid;
  v_key     text;
begin
select id, owner_id into v_room_id, v_owner
from public.rooms
where code = p_code
    limit 1;

if v_room_id is null then
    return null;
end if;

  if v_owner is distinct from auth.uid() then
    raise exception 'room owner mismatch';
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

grant execute on function public.get_current_deck_file_key(text) to authenticated;

-- 2) deck_id로 file_key 갱신 (업로드 후/자동 복구 시 사용)
create or replace function public.upsert_deck_file_by_id(p_deck_id uuid, p_file_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
update public.decks
set file_key = p_file_key
where id = p_deck_id;
return p_deck_id;
end $$;

grant execute on function public.upsert_deck_file_by_id(uuid, text) to authenticated;

commit;
