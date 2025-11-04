-- 0010_room_switch_and_state.sql
create or replace function public.set_room_deck(
  p_code text,
  p_slot int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
v_room_id uuid;
  v_deck_id uuid;
begin
select id into v_room_id
from public.rooms
where code = p_code and owner_id = auth.uid()
    limit 1;

if v_room_id is null then
    raise exception 'room not found or not owned';
end if;

select deck_id into v_deck_id
from public.room_decks
where room_id = v_room_id and slot = p_slot;

if v_deck_id is null then
    raise exception 'slot % has no deck', p_slot;
end if;

update public.rooms
set current_deck_id = v_deck_id,
    state = jsonb_build_object('slide',1,'step',0)
where id = v_room_id;

return v_deck_id;
end;
$$;
