-- Sincronización con la Garmin Personal API.
-- Datos del reloj pegados a cada sesión manual (duración, calorías y pulso del entrenamiento).
alter table public.workout_sessions
  add column if not exists garmin_activity_id bigint,
  add column if not exists duration_s numeric,
  add column if not exists calories integer,
  add column if not exists hr_avg integer,
  add column if not exists hr_max integer;
create unique index if not exists workout_sessions_garmin_activity_uidx
  on public.workout_sessions(garmin_activity_id) where garmin_activity_id is not null;

-- Resultado de la última sincronización (una sola fila).
create table if not exists public.garmin_sync_status (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_ok_at timestamptz,
  ok boolean,
  range_start date,
  range_end date,
  days integer,
  sessions_linked integer,
  message text
);
alter table public.garmin_sync_status enable row level security;
alter table public.garmin_sync_status force row level security;
revoke all on public.garmin_sync_status from anon, authenticated;
