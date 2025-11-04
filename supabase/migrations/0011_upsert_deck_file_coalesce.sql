-- 0011_upsert_deck_file_coalesce.sql
create or replace function public.upsert_deck_file(
  p_ext_id  text,
  p_file_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
v_id uuid;
begin
  -- 1) ext_id로 찾기
select id into v_id from public.decks where ext_id = p_ext_id;

-- 2) 못 찾으면 uuid 캐스팅해 id로 사용(덱 id를 받은 경우)
if v_id is null then
begin
      v_id := p_ext_id::uuid;
exception when invalid_text_representation then
      v_id := null;
end;
end if;

  if v_id is null then
    raise exception 'deck not found by ext_id or id: %', p_ext_id;
end if;

update public.decks set file_key = p_file_key where id = v_id;
return v_id;
end;
$$;

grant execute on function public.upsert_deck_file(text,text) to anon, authenticated;
