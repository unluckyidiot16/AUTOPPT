begin;

-- 0) rooms 테이블 없으면 생성
create table if not exists public.rooms (
                                            id         uuid primary key default gen_random_uuid(),
    code       text not null unique,
    title      text,
    owner_id   uuid references auth.users(id) on delete set null,
    is_open    boolean not null default true,
    expires_at timestamptz not null default (now() + interval '3 hours'),
    state      jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
    );

-- rooms.expires_at 보강 (여러 번 실행해도 안전)
alter table public.rooms
    add column if not exists expires_at timestamptz;

alter table public.rooms
    alter column expires_at set default (now() + interval '3 hours');

update public.rooms
set expires_at = now() + interval '3 hours'
where expires_at is null;

alter table public.rooms
    alter column expires_at set not null;


-- 0-2) RLS 보장
alter table if exists public.rooms   enable row level security;
alter table if exists public.answers enable row level security;

-- (선택) rooms 소유자 정책(조회/수정) - 없을 때만 생성
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='rooms' and policyname='rooms_owner_read'
  ) then
    execute $sql$
      create policy rooms_owner_read
      on public.rooms for select
                                                to authenticated
                                                using (owner_id = auth.uid());
$sql$;
end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='rooms' and policyname='rooms_owner_update'
  ) then
    execute $sql$
      create policy rooms_owner_update
      on public.rooms for update
                                                to authenticated
                                                using (owner_id = auth.uid())
                          with check (owner_id = auth.uid());
$sql$;
end if;
end $$;

-- 1) answers 정책 (room_id/room_code 타입 차이 자동 대응)
drop policy if exists answers_read_by_owner         on public.answers;
drop policy if exists answers_insert_when_room_open on public.answers;

do $$
declare
has_room_code boolean;
  has_room_id   boolean;
  room_id_type  text;
  cond_owner    text;
  cond_open     text;
begin
select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='answers' and column_name='room_code'
) into has_room_code;

select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='answers' and column_name='room_id'
) into has_room_id;

select data_type
from information_schema.columns
where table_schema='public' and table_name='answers' and column_name='room_id'
    into room_id_type;

-- 소유자 조회 조건
if has_room_code then
    cond_owner := 'r.code = answers.room_code';
  elsif has_room_id then
    cond_owner := (case when room_id_type = 'uuid'
                        then 'r.id = answers.room_id'
                        else 'r.id::text = answers.room_id'
                   end);
else
    cond_owner := 'false';
end if;

  -- 방 열림 체크 조건
  if has_room_code and has_room_id then
    cond_open := (case when room_id_type = 'uuid'
                       then 'r.id = answers.room_id and r.code = answers.room_code'
                       else 'r.id::text = answers.room_id and r.code = answers.room_code'
                  end);
  elsif has_room_code then
    cond_open := 'r.code = answers.room_code';
  elsif has_room_id then
    cond_open := (case when room_id_type = 'uuid'
                       then 'r.id = answers.room_id'
                       else 'r.id::text = answers.room_id'
                  end);
else
    cond_open := 'false';
end if;

execute format($SQL$
                   create policy answers_read_by_owner
    on public.answers for select
    to authenticated
    using (
      exists (select 1 from public.rooms r where %s and r.owner_id = auth.uid())
    )
  $SQL$, cond_owner);

execute format($SQL$
                   create policy answers_insert_when_room_open
    on public.answers for insert
    to anon, authenticated
                   with check (
      exists (
        select 1 from public.rooms r
        where %s
          and r.is_open = true
          and now() < r.expires_at
      )
    )
  $SQL$, cond_open);
end $$;

-- 2) RPC들
create or replace function public.create_room(p_title text default null, p_minutes int default 180)
returns public.rooms
language plpgsql
as $$
declare
v_code text;
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'auth required';
end if;

  -- 유니크 6자리 코드
  loop
v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.rooms where code = v_code);
end loop;

insert into public.rooms(code, title, owner_id, is_open, expires_at)
values (v_code, coalesce(p_title, 'Room'), auth.uid(), true, now() + make_interval(mins => coalesce(p_minutes,180)))
    returning * into v_room;

return v_room;
end
$$;

create or replace function public.update_room_state(p_code text, p_state jsonb)
returns public.rooms
language sql
as $$
update public.rooms
set state = coalesce(state, '{}'::jsonb) || coalesce(p_state, '{}'::jsonb)
where code = p_code and owner_id = auth.uid()
    returning *;
$$;

create or replace function public.submit_answer(p_room_code text, p_payload jsonb, p_student_id text default null)
returns public.answers
language plpgsql
security definer
set search_path = public
as $$
declare
v_room public.rooms;
  v_ans  public.answers;
begin
select * into v_room
from public.rooms
where code = p_room_code and is_open = true and now() < expires_at;

if not found then
    raise exception 'room not open or not found';
end if;

insert into public.answers(room_id, room_code, payload, student_id)
values (v_room.id, v_room.code, p_payload, p_student_id)
    returning * into v_ans;

return v_ans;
end
$$;

grant execute on function public.create_room(text, integer)      to authenticated;
grant execute on function public.update_room_state(text, jsonb)  to authenticated;
grant execute on function public.submit_answer(text, jsonb, text) to anon, authenticated;

commit;
