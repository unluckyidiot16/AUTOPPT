-- 0008_rpc_history_and_deckfile.sql (fixed)
begin;

-- fetch_history_by_code: 최근 제출 가져오기 (payload/answer_value/answer 다양한 스키마 호환)
create or replace function public.fetch_history_by_code(
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
) language plpgsql stable as
$$
declare
use_payload boolean;
  use_answer_value_col boolean;
sql text;
begin
  -- 현재 answers_v2 스키마 점검
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
select
    a.student_id,
    coalesce(a.payload->>'value', a.payload->>'answer') as answer_value,
    a.payload->>'answer' as answer,
    a.slide, a.step, a.created_at
from public.answers_v2 a
    join public.rooms r on r.id = a.room_id
where r.code = $1
  and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
elsif use_answer_value_col then
    sql := $SQL$
select
    a.student_id,
    a.answer_value,
    a.answer,
    a.slide, a.step, a.created_at
from public.answers_v2 a
         join public.rooms r on r.id = a.room_id
where r.code = $1
  and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
else
    -- 최소 스키마(= answer 만 존재) 폴백
    sql := $SQL$
select
    a.student_id,
    a.answer as answer_value,
    a.answer,
    a.slide, a.step, a.created_at
from public.answers_v2 a
         join public.rooms r on r.id = a.room_id
where r.code = $1
  and ($2 is null or a.created_at < $2)
order by a.created_at desc
    limit greatest(coalesce($3, 50), 0)
    $SQL$;
end if;

return query execute sql using p_room_code, p_before, p_limit;
end;
$$;

grant execute on function public.fetch_history_by_code(text, int, timestamptz) to authenticated;

-- decks 테이블 및 파일 키 업서트(원문 그대로 유지)
create table if not exists public.decks (
                                            id uuid primary key default gen_random_uuid(),
    ext_id text unique,
    title text,
    file_key text,
    created_at timestamptz not null default now()
    );

create or replace function public.upsert_deck_file(
  p_ext_id  text,
  p_file_key text
) returns void
language plpgsql
as $$
begin
update public.decks
set file_key = p_file_key
where ext_id = p_ext_id;

if not found then
    insert into public.decks(ext_id, title, file_key)
    values (p_ext_id, p_ext_id, p_file_key);
end if;
end
$$;

grant execute on function public.upsert_deck_file(text, text) to authenticated;

commit;
