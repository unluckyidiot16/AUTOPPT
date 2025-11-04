-- 0012_upsert_deck_file_by_slot.sql
create or replace function public.upsert_deck_file_by_slot(
  p_room_code text,
  p_slot      int,
  p_file_key  text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
v_room_id uuid;
  v_deck_id uuid;
begin
select id into v_room_id from public.rooms where code = p_room_code limit 1;
if v_room_id is null then
    raise exception 'room not found: %', p_room_code;
end if;

select deck_id into v_deck_id
from public.room_decks
where room_id = v_room_id and slot = p_slot
    limit 1;

if v_deck_id is null then
    raise exception 'no deck assigned to room % slot %', p_room_code, p_slot;
end if;

update public.decks set file_key = p_file_key where id = v_deck_id;
return v_deck_id;
end;
$$;

grant execute on function public.upsert_deck_file_by_slot(text,int,text) to anon, authenticated;
