-- supabase/migrations/<timestamp>_0007_drop_answers_dev_policies.sql
begin;
drop policy if exists answers_select_all on public.answers;
drop policy if exists answers_insert_all on public.answers;
commit;
