-- 0002_create_answers.sql (idempotent)

create table if not exists public.answers (
                                              id          bigserial primary key,
                                              room_id     text not null,
                                              slide       integer not null,
                                              step        integer not null,
                                              student_id  text,
                                              answer      text,
                                              created_at  timestamptz not null default now()
    );

-- RLS 보장
alter table public.answers enable row level security;

-- 읽기: 존재하면 스킵
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='answers' and policyname='answers_select_all'
  ) then
    execute $SQL$
      create policy answers_select_all
      on public.answers
      for select
                                using (true)
                                $SQL$;
end if;
end $$;

-- 쓰기: 존재하면 스킵
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public' and tablename='answers' and policyname='answers_insert_all'
  ) then
    execute $SQL$
      create policy answers_insert_all
      on public.answers
      for insert
      with check (true)
    $SQL$;
end if;
end $$;
