-- Master TestBook · server schema V3 (applied live 2026-10-16)
-- Adds where a question came from (paper, date, shift, official key). Safe to re-run.
alter table public.questions
  add column if not exists source_ref text check (source_ref is null or length(source_ref) <= 300);
