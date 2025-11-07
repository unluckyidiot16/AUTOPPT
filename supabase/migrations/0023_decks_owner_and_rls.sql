begin;

-- 1) 컬럼/인덱스/참조 키
alter table public.decks
    add column if not exists owner_id uuid;

create index if not exists idx_decks_owner on public.decks(owner_id);

-- (옵션) auth.users FK - 실패해도 무방 (권한 문제 시 생략)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decks_owner_fk'
  ) then
alter table public.decks
    add constraint decks_owner_fk
        foreign key (owner_id) references auth.users(id) on delete set null;
end if;
exception when others then
  -- hosted 환경에 따라 auth.users FK 거절될 수 있어 그냥 넘어갑니다.
  raise notice 'skip fk to auth.users: %', sqlerrm;
end $$;

-- 2) 기본값: 이후 INSERT 시 자동으로 소유자 주입
alter table public.decks
    alter column owner_id set default auth.uid();

-- 3) 백필: room_decks → rooms.owner_id를 우선 채택
update public.decks d
set owner_id = r.owner_id
    from public.room_decks rd
join public.rooms r on r.id = rd.room_id
where rd.deck_id = d.id
  and d.owner_id is null;

-- 3-1) 백필(보조): created_by 컬럼이 있으면 그것도 사용
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='decks' and column_name='created_by'
  ) then
update public.decks
set owner_id = created_by
where owner_id is null;
end if;
end $$;

-- 4) RLS 켜기 + 정책 재정의
alter table public.decks enable row level security;

drop policy if exists decks_sel_own on public.decks;
drop policy if exists decks_ins_own on public.decks;
drop policy if exists decks_upd_own on public.decks;
drop policy if exists decks_del_own on public.decks;

-- 읽기: 자신의 것만
create policy decks_sel_own
on public.decks
for select
                                   to authenticated
                                   using (owner_id = auth.uid());

-- 쓰기: 자신의 것만 만들고/수정/삭제
create policy decks_ins_own
on public.decks
for insert
to authenticated
with check (owner_id = auth.uid());

create policy decks_upd_own
on public.decks
for update
                      to authenticated
                      using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

create policy decks_del_own
on public.decks
for delete
to authenticated
using (owner_id = auth.uid());

-- 5) INSERT 시 owner_id 자동 셋 (클라이언트가 안 보내도 안전)
create or replace function public.set_deck_owner()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
end if;
return new;
end $$;

drop trigger if exists trg_set_deck_owner on public.decks;
create trigger trg_set_deck_owner
    before insert on public.decks
    for each row
    execute function public.set_deck_owner();

-- 6) 모두 채워졌으면 NOT NULL로 격상(안전 모드)
do $$
begin
  if not exists (select 1 from public.decks where owner_id is null) then
alter table public.decks alter column owner_id set not null;
end if;
end $$;

commit;
