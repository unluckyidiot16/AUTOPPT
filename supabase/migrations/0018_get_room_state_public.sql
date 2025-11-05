-- 0018_get_room_state_public.sql
-- 목적: 학생(anon/로그인 불문)이 현재 방의 slide/step 초기 상태를 안전하게 가져올 수 있게 함.
--       rooms.state가 비어 있으면 {slide:1, step:0} 기본값 반환.

begin;

-- 성능 보강(이미 있으면 생략됨)
create index if not exists idx_rooms_code on public.rooms(code);

-- 시그니처 충돌 방지
drop function if exists public.get_room_state_public(text);

create or replace function public.get_room_state_public(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
v_state jsonb;
begin
select r.state
into v_state
from public.rooms r
where r.code = p_code
    limit 1;

if v_state is null or v_state = '{}'::jsonb then
    return jsonb_build_object('slide', 1, 'step', 0);
end if;

return v_state;
end
$$;

-- 학생/교사 모두 호출 가능
grant execute on function public.get_room_state_public(text) to anon, authenticated;

commit;
