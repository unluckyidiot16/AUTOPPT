-- 003_unify_create_room.sql
drop function if exists public.create_room(text);
drop function if exists public.create_room(text, integer);

create or replace function public.create_room(
  p_title   text default null,
  p_minutes integer default 180
)
returns table(id uuid, code text)
language plpgsql
security definer
as $$
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
insert into public.rooms(id, code, owner_id, title, is_open, expires_at)
values (gen_random_uuid(), v_code, v_owner, coalesce(p_title, v_code), true, now() + make_interval(mins => p_minutes))
    returning rooms.id, rooms.code into v_id, v_code;
exit;
exception when unique_violation then
      if tries > 5 then raise; end if;
end;
end loop;

return query select v_id, v_code;
end $$;
