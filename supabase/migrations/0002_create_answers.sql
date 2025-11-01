create table if not exists public.answers (
                                              id          bigserial primary key,
                                              room_id     text not null,
                                              slide       integer not null,
                                              step        integer not null,
                                              student_id  text,
                                              answer      text,
                                              created_at  timestamptz not null default now()
    );

-- 읽기는 전부 허용(테스트 용)
alter table public.answers enable row level security;

create policy "answers_select_all"
  on public.answers
  for select
                 using (true);

create policy "answers_insert_all"
  on public.answers
  for insert
  with check (true);
