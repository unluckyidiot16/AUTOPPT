-- 0013_create_deck_and_assign.sql
create or replace function public.create_deck_and_assign(
  p_code text, p_slot int, p_title text, p_slug text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_room_id uuid; v_deck_id uuid;
begin
select id into v_room_id from rooms where code=p_code limit 1;
if v_room_id is null then
    insert into rooms(code,state) values (p_code, jsonb_build_object('slide',1,'step',0))
    returning id into v_room_id;
end if;
insert into decks(title, ext_id) values (coalesce(p_title,''), p_slug) returning id into v_deck_id;
insert into room_decks(room_id,slot,deck_id)
values (v_room_id,p_slot,v_deck_id)
    on conflict (room_id,slot) do update set deck_id=excluded.deck_id;
return v_deck_id;
end $$;
grant execute on function public.create_deck_and_assign(text,int,text,text) to anon, authenticated;
