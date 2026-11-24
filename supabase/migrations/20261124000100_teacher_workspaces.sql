-- Teacher-owned Class Quest workspace. Student access is intentionally handled by the student-portal Edge Function.
create table if not exists public.teacher_workspaces (
  teacher_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"settings":{"cap":50,"budget":1500},"classes":[],"students":[],"ledger":[],"orders":[],"actions":[],"prizes":[]}'::jsonb,
  class_codes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists teacher_workspaces_class_codes_gin
  on public.teacher_workspaces using gin (class_codes);

alter table public.teacher_workspaces enable row level security;

grant select, insert, update, delete on public.teacher_workspaces to authenticated;

drop policy if exists "Teachers read their own workspace" on public.teacher_workspaces;
create policy "Teachers read their own workspace"
  on public.teacher_workspaces for select to authenticated
  using ((select auth.uid()) = teacher_id);

drop policy if exists "Teachers create their own workspace" on public.teacher_workspaces;
create policy "Teachers create their own workspace"
  on public.teacher_workspaces for insert to authenticated
  with check ((select auth.uid()) = teacher_id);

drop policy if exists "Teachers update their own workspace" on public.teacher_workspaces;
create policy "Teachers update their own workspace"
  on public.teacher_workspaces for update to authenticated
  using ((select auth.uid()) = teacher_id)
  with check ((select auth.uid()) = teacher_id);

drop policy if exists "Teachers delete their own workspace" on public.teacher_workspaces;
create policy "Teachers delete their own workspace"
  on public.teacher_workspaces for delete to authenticated
  using ((select auth.uid()) = teacher_id);

comment on table public.teacher_workspaces is
  'Private JSON workspace for each Class Quest teacher. Student reads and purchases are mediated by the student-portal Edge Function.';
