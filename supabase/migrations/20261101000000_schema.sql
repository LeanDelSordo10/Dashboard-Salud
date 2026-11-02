-- Dashboard Salud: esquema base.
-- Seguridad: RLS activado en todas las tablas SIN políticas y sin permisos para
-- anon/authenticated. Solo la Edge Function `api` (service role) accede a los datos.

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_muscle text,
  secondary_muscles text[] not null default '{}',
  equipment text,
  measurement_type text not null default 'weight_reps',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.routine_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.routine_exercises (
  id bigserial primary key,
  routine_id uuid not null references public.routine_templates(id) on delete cascade,
  day_code text not null,
  position integer not null,
  exercise_id uuid not null references public.exercises(id),
  target_sets integer,
  target_reps_min integer,
  target_reps_max integer,
  target_weight_kg numeric,
  notes text
);
create index if not exists routine_exercises_routine_day_idx on public.routine_exercises(routine_id, day_code, position);
create index if not exists routine_exercises_exercise_idx on public.routine_exercises(exercise_id);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  status text not null default 'open' check (status in ('open','completed')),
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists workout_sessions_date_idx on public.workout_sessions(date desc);

create table if not exists public.workout_sets (
  id bigserial primary key,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  planned_exercise_id uuid references public.exercises(id),
  set_number integer not null,
  weight_kg numeric,
  reps integer,
  duration_s numeric,
  rest_s numeric,
  rir numeric,
  rpe numeric,
  created_at timestamptz not null default now()
);
create index if not exists workout_sets_session_idx on public.workout_sets(session_id);
create index if not exists workout_sets_exercise_idx on public.workout_sets(exercise_id);
create index if not exists workout_sets_planned_idx on public.workout_sets(planned_exercise_id);

create table if not exists public.garmin_strength_imports (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text,
  filename text,
  file_sha256 text,
  duration_s numeric,
  calories integer,
  hr_avg integer,
  hr_max integer,
  raw_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists garmin_strength_imports_date_idx on public.garmin_strength_imports(date desc);

create table if not exists public.garmin_strength_sets (
  id bigserial primary key,
  import_id uuid not null references public.garmin_strength_imports(id) on delete cascade,
  set_number integer,
  set_type text,
  exercise_name_garmin text,
  exercise_category integer,
  exercise_subtype integer,
  duration_s numeric,
  reps integer,
  weight_kg numeric,
  muscles_primary text[] not null default '{}',
  muscles_secondary text[] not null default '{}'
);
create index if not exists garmin_strength_sets_import_idx on public.garmin_strength_sets(import_id);

create table if not exists public.body_weight_records (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null default now(),
  measurement_date date not null unique,
  weight_kg numeric not null check (weight_kg > 20 and weight_kg < 400),
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_goals (
  id smallint primary key default 1 check (id = 1),
  daily_steps_goal integer,
  weekly_intensity_minutes_goal integer,
  target_weight_kg numeric,
  body_goal text,
  weekly_strength_sessions_goal integer,
  nightly_sleep_hours_goal numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_health (
  date date primary key,
  steps integer,
  distance_m numeric,
  active_seconds integer,
  active_calories integer,
  sleep_seconds integer,
  hrv_rmssd numeric,
  resting_hr integer,
  weight_kg numeric,
  skin_temp_c numeric,
  source_fit boolean not null default false,
  source_tredict boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.garmin_daily_validated (
  date date primary key,
  steps integer,
  source text not null default 'garmin_connect_csv',
  updated_at timestamptz not null default now()
);

-- Historial de series con la fecha de la sesión.
create or replace view public.workout_set_history
with (security_invoker = true) as
select s.id, s.session_id, s.exercise_id, s.planned_exercise_id, s.set_number,
       s.weight_kg, s.reps, ws.date as performed_at, ws.title as session_title, ws.status
from public.workout_sets s
join public.workout_sessions ws on ws.id = s.session_id;

-- Cerrar la base: RLS sin políticas + revocar permisos a roles públicos.
do $$
declare t text;
begin
  foreach t in array array['exercises','routine_templates','routine_exercises','workout_sessions','workout_sets',
    'garmin_strength_imports','garmin_strength_sets','body_weight_records','dashboard_goals','daily_health','garmin_daily_validated']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on public.workout_set_history from anon, authenticated;
revoke usage, select on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
