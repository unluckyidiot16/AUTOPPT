-- 0009_rpc_fix_history_and_set_room.sql
-- 1) 최근 제출: 다양한 스키마(payload/answer_value/answer) 호환 + 소유자 검증
create or replace function public.fetch_history_by_code_v2(
  p_room_code text,
  p_limit     int default 50,
  p_before    timestamptz default null
) returns table(
  student_id   text,
  answer_value text,
  answer       text,
  slide        int,
  step         int,
  created_at   timestamptz
) language plpgsql
security definer
set search_path = public
stable
as $$
declare
v_room_id uuid;
  use_payload boolean;
  use_answer_value_col boolean;
sql text;
begin
select id into v_room_id
from public.rooms
where code = p_room_code and owner_id = auth.uid()
    limit 1;

if v_room_id is null then
    -- 방이 없거나 소유자가 아님
    return;
end if;

select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='answers_v2' and column_name='payload'
) into use_payload;

select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='answers_v2' and column_name='answer_value'
) into use_answer_value_col;

if use_payload then
    sql := $SQL$
select a.student_id,
       coalesce(a.payload->>'value', a.payload->>'answer') as answer_value,
       a.payload->>'answer' as answer,
    a.slide, a.step, a.created_at
from public.answers_v2 a
where a.room_id = $1 and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
elsif use_answer_value_col then
    sql := $SQL$
select a.student_id, a.answer_value, a.answer, a.slide, a.step, a.created_at
from public.answers_v2 a
where a.room_id = $1 and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
else
    sql := $SQL$
select a.student_id, a.answer as answer_value, a.answer, a.slide, a.step, a.created_at
from public.answers_v2 a
where a.room_id = $1 and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
end if;

return query execute sql using v_room_id, p_before, p_limit;
end;
$$;

grant execute on function public.fetch_history_by_code_v2(text,int,timestamptz) to anon, authenticated;

-- 2) 전환: rooms.current_deck_id를 반드시 갱신
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

select rd.deck_id into v_deck_id
from public.room_decks rd
where rd.room_id = v_room_id and rd.slot = p_slot;

update public.rooms
set current_deck_id = v_deck_id
where id = v_room_id;

return v_deck_id;
end;
$$;

grant execute on function public.set_room_deck(text,int) to anon, authenticated;

-- 3) 자료함: 현재 방의 소유자가 배정한 덱만 안전하게 조회
create or replace function public.list_decks_by_room_owner(
  p_room_code text
) returns table(
  id uuid, ext_id text, title text, file_key text, created_at timestamptz
) language sql
security definer
set search_path = public
as $$
select d.id, d.ext_id, d.title, d.file_key, d.created_at
from public.rooms r
         join public.room_decks rd on rd.room_id = r.id
         join public.decks d on d.id = rd.deck_id
where r.code = p_room_code and r.owner_id = auth.uid()
order by d.created_at desc
    $$;

grant execute on function public.list_decks_by_room_owner(text) to anon, authenticated;
