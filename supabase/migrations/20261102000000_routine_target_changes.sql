-- Historial de actualizaciones automáticas de objetivos de la rutina
-- (peso, repeticiones y series). Cerrada como el resto: solo la usa la API.
create table if not exists public.routine_target_changes (
  id bigserial primary key,
  routine_exercise_id bigint not null references public.routine_exercises(id) on delete cascade,
  changed_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null,
  sessions jsonb not null default '[]'::jsonb
);
create index if not exists routine_target_changes_item_idx on public.routine_target_changes(routine_exercise_id, changed_at desc);
alter table public.routine_target_changes enable row level security;
alter table public.routine_target_changes force row level security;
revoke all on public.routine_target_changes from anon, authenticated;
revoke all on sequence public.routine_target_changes_id_seq from anon, authenticated;
