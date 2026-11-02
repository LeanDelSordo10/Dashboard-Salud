-- Vistas de historial con la fecha de la sesión, para filtrar series por rango de fechas
-- sin listas enormes de IDs. Cerradas como el resto (solo las usa la API).
drop view if exists public.workout_set_history;
create view public.workout_set_history
with (security_invoker = true) as
select s.id, s.session_id, s.exercise_id, s.planned_exercise_id, s.set_number,
       s.weight_kg, s.reps, s.duration_s, ws.date as performed_at, ws.title as session_title, ws.status
from public.workout_sets s
join public.workout_sessions ws on ws.id = s.session_id;

create or replace view public.garmin_set_history
with (security_invoker = true) as
select g.id, g.import_id, g.set_number, g.set_type, g.exercise_name_garmin, g.duration_s, g.reps, g.weight_kg,
       i.date as performed_at, i.title as session_title
from public.garmin_strength_sets g
join public.garmin_strength_imports i on i.id = g.import_id;

revoke all on public.workout_set_history from anon, authenticated;
revoke all on public.garmin_set_history from anon, authenticated;
create index if not exists workout_sessions_date_title_idx on public.workout_sessions(date, title);
