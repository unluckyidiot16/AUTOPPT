-- 0010_p1_unify_page.sql
-- P1: page 단일화 (rooms.state.page / room_decks.current_page / RPC3)

begin;

-- 안전장치
alter table if exists public.rooms
    add column if not exists state jsonb not null default '{}'::jsonb;

alter table if exists public.room_decks
    add column if not exists current_page int not null default 1;

-- rooms.state.page 백필 (없으면 기존 slide 사용, 없으면 1)
update public.rooms r
set state = jsonb_set(
        coalesce(r.state, '{}'::jsonb),
        '{page}',
        to_jsonb(
                coalesce(nullif(r.state->>'page','')::int,
                         nullif(r.state->>'slide','')::int,
                         1)
        ),
        true
            )
where (r.state->>'page') is null;

-- room_decks.current_page 백필: 1(초기값)이면 rooms.state.page를 준용
update public.room_decks d
set current_page = greatest(
        1,
        (select coalesce((r.state->>'page')::int, 1) from public.rooms r where r.id = d.room_id)
                   )
where coalesce(current_page,1) = 1;

-- RPC: 학생 초기 진입용 (public)
create or replace function public.get_current_page_public(p_code text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
v_room_id uuid;
  v_page int;
begin
select id into v_room_id from public.rooms where code = p_code;
if v_room_id is null then
    raise exception 'room_not_found';
end if;
select coalesce((state->>'page')::int, 1) into v_page from public.rooms where id = v_room_id;
return greatest(v_page, 1);
end
$$;
revoke all on function public.get_current_page_public(text) from public;
grant execute on function public.get_current_page_public(text) to anon, authenticated;

-- RPC: 교사용 페이지 이동 (owner만)
create or replace function public.goto_page(p_code text, p_page int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
v_room record;
begin
select id, owner_id into v_room
from public.rooms
where code = p_code;

if v_room.id is null then
    raise exception 'room_not_found';
end if;
  if v_room.owner_id is distinct from auth.uid() then
    raise exception 'permission_denied';
end if;

update public.rooms
set state = jsonb_set(coalesce(state,'{}'::jsonb), '{page}', to_jsonb(greatest(p_page,1)), true),
    updated_at = now()
where id = v_room.id;

return greatest(p_page, 1);
end
$$;
revoke all on function public.goto_page(text,int) from public;
grant execute on function public.goto_page(text,int) to authenticated;

-- RPC: 슬롯별 진행 페이지 저장(선택 사용)
create or replace function public.set_current_page_for_slot(p_code text, p_slot int, p_page int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
v_room record;
begin
select id, owner_id into v_room from public.rooms where code = p_code;
if v_room.id is null then raise exception 'room_not_found'; end if;
  if v_room.owner_id is distinct from auth.uid() then raise exception 'permission_denied'; end if;

update public.room_decks
set current_page = greatest(p_page,1)
where room_id = v_room.id and slot = p_slot;
end
$$;
revoke all on function public.set_current_page_for_slot(text,int,int) from public;
grant execute on function public.set_current_page_for_slot(text,int,int) to authenticated;

commit;
