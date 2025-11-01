-- 현재 방 상태 (늦게 들어온 학생이 여기서 상태 하나만 읽어가게)
create table if not exists public.ppt_rooms (
                                                id text primary key,
                                                slide int not null default 1,
                                                step int not null default 0,
                                                updated_at timestamptz not null default now()
    );

-- 학생이 보낸 "정답입니다" 요청 로그
create table if not exists public.ppt_unlock_requests (
                                                          id bigserial primary key,
                                                          room_id text not null,
                                                          student_id text,
                                                          slide int not null,
                                                          step int not null,
                                                          answer text not null,
                                                          created_at timestamptz not null default now()
    );
