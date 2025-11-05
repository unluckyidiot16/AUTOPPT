-- 0014_ppt_core_fix.sql
-- 목적:
-- 1) room_decks 테이블(슬롯-덱 매핑) 보강/신규 생성
-- 2) rooms.current_deck_id 컬럼 추가
-- 3) 프런트에서 실제 호출 중인 RPC들 정식 구현/교체
--    - claim_room_auth
--    - list_decks_by_room_owner
--    - assign_room_deck_by_id
--    - assign_room_deck_by_ext
--    - set_room_deck
--    - goto_slide
--    - upsert_deck_file_by_slot
--    - upsert_deck_file(p_room_code, p_slot, p_file_key)  -- (legacy A 오버로드)

begin;

-- 확장(필요 시)
create extension if not exists pgcrypto;

-- rooms 테이블 보강: current_deck_id / state 존재 보장
alter table public.rooms
    add column if not exists current_deck_id uuid references public.decks(id) on delete set null;

alter table public.rooms
    add column if not exists state jsonb not null default '{}'::jsonb;

alter table public.rooms
    add column if not exists created_at timestamptz not null default now();

-- room_decks 테이블 생성(없으면)
create table if not exists public.room_decks (
                                                 room_id     uuid not null references public.rooms(id) on delete cascade,
    slot        int  not null,
    deck_id     uuid not null references public.decks(id) on delete cascade,
    current_page int  not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (room_id, slot)
    );

-- updated_at 트리거
create or replace function public._set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'tr_room_decks_updated_at'
  ) then
create trigger tr_room_decks_updated_at
    before update on public.room_decks
    for each row execute function public._set_updated_at();
end if;
end $$;

-- 인덱스(참조 및 조회 성능)
create index if not exists idx_room_decks_room on public.room_decks(room_id);
create index if not exists idx_room_decks_deck on public.room_decks(deck_id);

--------------------------------------------------------------------------------
-- 권한/소유 확인 유틸: 방 코드로 방/소유자 확인
--------------------------------------------------------------------------------
create or replace function public._ensure_room_owner(p_code text)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
v_room_id uuid;
  v_owner   uuid;
begin
select id, owner_id into v_room_id, v_owner
from public.rooms
where code = p_code
    limit 1;

if v_room_id is null then
    -- 방이 없으면 생성 + 소유자 귀속
    insert into public.rooms(code, owner_id, state)
    values (p_code, auth.uid(), jsonb_build_object('slide',1,'step',0))
    returning id into v_room_id;
return v_room_id;
end if;

  -- 소유자 없으면 현재 사용자에게 귀속(첫 소유자 확보)
  if v_owner is null then
update public.rooms
set owner_id = auth.uid()
where id = v_room_id;
return v_room_id;
end if;

  -- 소유자 존재 + 타인인 경우에는 예외
  if v_owner <> auth.uid() then
    raise exception 'room owner mismatch';
end if;

return v_room_id;
end $$;

grant execute on function public._ensure_room_owner(text) to authenticated;

--------------------------------------------------------------------------------
-- 1) 방 소유 클레임: 이미 소유되어 있으면 그대로, 없으면 본인에게 귀속
--------------------------------------------------------------------------------
create or replace function public.claim_room_auth(p_code text)
returns uuid
language plpgsql security definer set search_path=public as $$
declare v_room_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_code);
return v_room_id;
end $$;

grant execute on function public.claim_room_auth(text) to authenticated;

--------------------------------------------------------------------------------
-- 2) 소유자 기준 자료함 목록: 소유자 확인 후 decks 목록 리턴
--    (초기 스키마에 decks.owner_id가 없으므로 전체 decks를 최신순으로 반환)
--------------------------------------------------------------------------------
create or replace function public.list_decks_by_room_owner(p_room_code text)
returns setof public.decks
language plpgsql security definer set search_path=public as $$
declare v_room_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_room_code); -- 소유자 검증
return query
select d.* from public.decks d
order by d.created_at desc;
end $$;

grant execute on function public.list_decks_by_room_owner(text) to authenticated;

--------------------------------------------------------------------------------
-- 3) 슬롯에 덱 배정(덱 id로)
--------------------------------------------------------------------------------
create or replace function public.assign_room_deck_by_id(
  p_code    text,
  p_slot    int,
  p_deck_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_room_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_code);

insert into public.room_decks(room_id, slot, deck_id)
values (v_room_id, p_slot, p_deck_id)
    on conflict (room_id, slot) do update
                                       set deck_id = excluded.deck_id,
                                       updated_at = now();

return p_deck_id;
end $$;

grant execute on function public.assign_room_deck_by_id(text,int,uuid) to authenticated;

--------------------------------------------------------------------------------
-- 4) 슬롯에 덱 배정(ext_id로): ext_id가 없으면 생성(title 폴백)
--------------------------------------------------------------------------------
create or replace function public.assign_room_deck_by_ext(
  p_code   text,
  p_slot   int,
  p_ext_id text,
  p_title  text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
v_room_id uuid;
  v_deck_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_code);

select id into v_deck_id from public.decks where ext_id = p_ext_id;
if v_deck_id is null then
    insert into public.decks(ext_id, title)
    values (p_ext_id, coalesce(p_title, p_ext_id))
    returning id into v_deck_id;
end if;

insert into public.room_decks(room_id, slot, deck_id)
values (v_room_id, p_slot, v_deck_id)
    on conflict (room_id, slot) do update
                                       set deck_id = excluded.deck_id,
                                       updated_at = now();

return v_deck_id;
end $$;

grant execute on function public.assign_room_deck_by_ext(text,int,text,text) to authenticated;

--------------------------------------------------------------------------------
-- 5) 현재 교시 전환(set_room_deck): 해당 슬롯의 deck_id를 rooms.current_deck_id로 설정 + 상태 초기화
--------------------------------------------------------------------------------
create or replace function public.set_room_deck(
  p_code text,
  p_slot int
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
v_room_id uuid;
  v_deck_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_code);

select deck_id into v_deck_id
from public.room_decks
where room_id = v_room_id and slot = p_slot;

if v_deck_id is null then
    raise exception 'slot % has no deck', p_slot;
end if;

update public.rooms
set current_deck_id = v_deck_id,
    state = jsonb_build_object('slide', 1, 'step', 0)
where id = v_room_id;

return v_deck_id;
end $$;

grant execute on function public.set_room_deck(text,int) to authenticated;

--------------------------------------------------------------------------------
-- 6) 슬라이드 이동(goto_slide): rooms.state에 slide/step 저장
--------------------------------------------------------------------------------
create or replace function public.goto_slide(
  p_code  text,
  p_slide int,
  p_step  int
) returns void
language plpgsql security definer set search_path=public as $$
declare v_room_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_code);

update public.rooms
set state = jsonb_build_object('slide', greatest(1, p_slide), 'step', greatest(0, p_step))
where id = v_room_id;
end $$;

grant execute on function public.goto_slide(text,int,int) to authenticated;

--------------------------------------------------------------------------------
-- 7) 업로드 후 file_key 설정 by_slot (가장 우선 시도)
--------------------------------------------------------------------------------
create or replace function public.upsert_deck_file_by_slot(
  p_room_code text,
  p_slot      int,
  p_file_key  text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
v_room_id uuid;
  v_deck_id uuid;
begin
  v_room_id := public._ensure_room_owner(p_room_code);

select deck_id into v_deck_id
from public.room_decks
where room_id = v_room_id and slot = p_slot;

if v_deck_id is null then
    raise exception 'slot % has no deck', p_slot;
end if;

update public.decks
set file_key = p_file_key
where id = v_deck_id;

return v_deck_id;
end $$;

grant execute on function public.upsert_deck_file_by_slot(text,int,text) to authenticated;

--------------------------------------------------------------------------------
-- 8) (legacy A) 업로드 후 file_key 설정: upsert_deck_file(p_room_code, p_slot, p_file_key)
--    이름은 동일하지만 시그니처로 기존 ext_id 버전과 구분.
--------------------------------------------------------------------------------
create or replace function public.upsert_deck_file(
  p_room_code text,
  p_slot      int,
  p_file_key  text
) returns uuid
language plpgsql security definer set search_path=public as $$
begin
return public.upsert_deck_file_by_slot(p_room_code, p_slot, p_file_key);
end $$;

grant execute on function public.upsert_deck_file(text,int,text) to authenticated;

commit;
