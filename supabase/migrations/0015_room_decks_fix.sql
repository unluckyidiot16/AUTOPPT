-- 0015_room_decks_fix.sql
-- 목적: 기존 room_decks에 누락된 타임스탬프 컬럼/트리거 보강

begin;

-- 누락 컬럼 보강
alter table public.room_decks
    add column if not exists created_at timestamptz not null default now();

alter table public.room_decks
    add column if not exists updated_at timestamptz not null default now();

-- updated_at 자동 갱신 트리거 함수(없으면 생성/있으면 교체)
create or replace function public._set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
return new;
end $$;

-- BEFORE UPDATE 트리거 존재 보장
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

commit;
