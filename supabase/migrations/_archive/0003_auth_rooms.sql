-- 확장
create extension if not exists pgcrypto;

-- 1) 프로필(선택: 교사 표시용, auth.users와 1:1)
create table if not exists public.profiles (
                                               id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now()
    );
alter table public.profiles enable row level security;

-- 소유자만 자기 프로필 읽기/쓰기
create policy "profiles_self_select"
on public.profiles for select
                                  to authenticated
                                  using ( id = auth.uid() );

create policy "profiles_self_upsert"
on public.profiles for all
to authenticated
using ( id = auth.uid() )
with check ( id = auth.uid() );

-- 2) 수업 방(교사 소유)
create table if not exists public.rooms (
                                            id uuid primary key default gen_random_uuid(),
    code text not null unique,                         -- QR용 6자리 코드
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text,
    state jsonb not null default '{}'::jsonb,          -- {slide, step, locked, ...}
    is_open boolean not null default true,
    expires_at timestamptz not null default (now() + interval '12 hours'),
    created_at timestamptz not null default now()
    );

alter table public.rooms enable row level security;

-- 누구나(학생 포함) 현재 열려있는 방의 행은 조회 가능 (상태 반영용)
create policy "rooms_public_read_when_open"
on public.rooms for select
                               to anon, authenticated
                               using ( is_open = true and now() < expires_at );

-- 교사만 본인 방 생성
create policy "rooms_insert_by_owner"
on public.rooms for insert
to authenticated
with check ( owner_id = auth.uid() );

-- 교사만 본인 방 상태 업데이트
create policy "rooms_update_by_owner"
on public.rooms for update
                                      to authenticated
                                      using ( owner_id = auth.uid() )
                    with check ( owner_id = auth.uid() );

-- (권장) 업데이트 가능한 컬럼 제한: state, is_open, expires_at
revoke update on public.rooms from authenticated;
grant update (state, is_open, expires_at) on public.rooms to authenticated;

-- 3) 답안(익명 제출 허용; 방이 열려 있어야)
create table if not exists public.answers (
                                              id bigserial primary key,
                                              room_id uuid not null references public.rooms(id) on delete cascade,
    room_code text not null,
    submitted_at timestamptz not null default now(),
    student_id text,               -- 선택: 닉네임/장치ID 등
    payload jsonb not null         -- {qId, choice, correct, timeMs...} (정답은 서버 재판단 권장)
    );

alter table public.answers enable row level security;

-- answers_read_by_owner: 스키마 차이를 자동 대응( room_code / room_id(uuid/text) )
alter table public.answers enable row level security;
drop policy if exists answers_read_by_owner on public.answers;

do $$
declare
has_room_code boolean;
  has_room_id   boolean;
  room_id_type  text;
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

if has_room_code then
    execute $sql$
      create policy answers_read_by_owner
      on public.answers for select
                                                to authenticated
                                                using (
                                                exists (
                                                select 1 from public.rooms r
                                                where r.code = answers.room_code
                                                and r.owner_id = auth.uid()
                                                )
                                                )
                                                $sql$;

elsif has_room_id then
    if room_id_type = 'uuid' then
      execute $sql$
        create policy answers_read_by_owner
        on public.answers for select
                                                       to authenticated
                                                       using (
                                                       exists (
                                                       select 1 from public.rooms r
                                                       where r.id = answers.room_id
                                                       and r.owner_id = auth.uid()
                                                       )
                                                       )
                                                       $sql$;
else
      -- room_id 가 text 인 경우: 타입 충돌 방지 위해 uuid::text 로 비교
      execute $sql$
        create policy answers_read_by_owner
        on public.answers for select
                                                 to authenticated
                                                 using (
                                                 exists (
                                                 select 1 from public.rooms r
                                                 where r.id::text = answers.room_id
                                                 and r.owner_id = auth.uid()
                                                 )
                                                 )
                                                 $sql$;
end if;

else
    -- 컬럼이 둘 다 없다면 일단 deny (나중에 스키마 표준화 후 교체)
    execute $sql$
      create policy answers_read_by_owner
      on public.answers for select
                                             to authenticated
                                             using (false)
                                             $sql$;
end if;
end $$;

-- 익명/학생도 제출 가능(방 열림 & 유효기간 확인)
create policy "answers_insert_when_room_open"
on public.answers for insert
to anon, authenticated
with check ( exists (
  select 1 from public.rooms r
  where r.id = answers.room_id
    and r.code = answers.room_code
    and r.is_open = true
    and now() < r.expires_at
));

-- 4) 방 생성/상태 업데이트/답안 제출용 RPC
-- 방 코드 생성 + 방 만들기 (교사 전용)
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

  -- 유니크 6자리 코드 생성(충돌 시 재시도)
  loop
v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)); -- ex: '7XTP45'
    exit when not exists (select 1 from public.rooms where code = v_code);
end loop;

insert into public.rooms(code, title, expires_at)
values (v_code, coalesce(p_title, 'Room'), now() + make_interval(mins => coalesce(p_minutes,180)))
    returning * into v_room;

return v_room;
end
$$;

-- 방 상태 병합 업데이트 (교사 전용)
create or replace function public.update_room_state(p_code text, p_state jsonb)
returns public.rooms
language sql
as $$
update public.rooms
set state = coalesce(state, '{}'::jsonb) || coalesce(p_state, '{}'::jsonb)
where code = p_code and owner_id = auth.uid()
    returning *;
$$;

-- (선택) 답안 제출을 RPC로 통일해 추가 검증/정규화
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

-- 권한 부여
grant execute on function public.create_room to authenticated;
grant execute on function public.update_room_state to authenticated;
grant execute on function public.submit_answer to anon, authenticated;
