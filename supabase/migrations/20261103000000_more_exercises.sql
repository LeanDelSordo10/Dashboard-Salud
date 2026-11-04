-- Más ejercicios típicos en el catálogo (para "Cambiar ejercicio" al registrar).
-- Idempotente: no inserta un nombre que ya exista (sin importar mayúsculas).
-- Los grupos musculares son los 11 de web/assets/muscle-map.json.
create unique index if not exists exercises_name_lower_uidx on public.exercises (lower(name));

insert into public.exercises (name, primary_muscle, secondary_muscles, equipment, measurement_type)
select v.name, v.muscle, v.secondary, v.equipment, v.mtype
from (values
  -- Pecho
  ('Press banca con mancuernas',      'Pecho', array['Tríceps','Hombros'], 'Mancuernas', 'weight_reps'),
  ('Press inclinado con mancuernas',  'Pecho', array['Hombros','Tríceps'], 'Mancuernas', 'weight_reps'),
  ('Press declinado',                 'Pecho', array['Tríceps'], 'Barra', 'weight_reps'),
  ('Press de pecho en máquina',       'Pecho', array['Tríceps','Hombros'], 'Máquina', 'weight_reps'),
  ('Aperturas con mancuernas',        'Pecho', array['Hombros'], 'Mancuernas', 'weight_reps'),
  ('Fondos en paralelas',             'Pecho', array['Tríceps','Hombros'], 'Peso corporal', 'weight_reps'),
  ('Flexiones de brazos',             'Pecho', array['Tríceps','Hombros'], 'Peso corporal', 'weight_reps'),
  -- Espalda
  ('Dominadas',                       'Espalda', array['Bíceps'], 'Peso corporal', 'weight_reps'),
  ('Remo con barra',                  'Espalda', array['Bíceps'], 'Barra', 'weight_reps'),
  ('Remo con mancuerna a una mano',   'Espalda', array['Bíceps'], 'Mancuerna', 'weight_reps'),
  ('Remo en T',                       'Espalda', array['Bíceps'], 'Barra / máquina', 'weight_reps'),
  ('Peso muerto',                     'Espalda', array['Isquiotibiales','Glúteos'], 'Barra', 'weight_reps'),
  ('Hiperextensiones lumbares',       'Espalda', array['Glúteos','Isquiotibiales'], 'Peso corporal', 'weight_reps'),
  ('Encogimientos (trapecio)',        'Espalda', array[]::text[], 'Mancuernas / barra', 'weight_reps'),
  -- Hombros
  ('Press de hombros en máquina',     'Hombros', array['Tríceps'], 'Máquina', 'weight_reps'),
  ('Elevaciones frontales',           'Hombros', array[]::text[], 'Mancuernas', 'weight_reps'),
  ('Vuelos posteriores / Pájaros',    'Hombros', array['Espalda'], 'Mancuernas / máquina', 'weight_reps'),
  ('Vuelos laterales en polea',       'Hombros', array[]::text[], 'Polea', 'weight_reps'),
  ('Face pull',                       'Hombros', array['Espalda'], 'Polea', 'weight_reps'),
  ('Remo al mentón',                  'Hombros', array['Espalda','Bíceps'], 'Barra / polea', 'weight_reps'),
  -- Bíceps
  ('Curl con barra',                  'Bíceps', array[]::text[], 'Barra', 'weight_reps'),
  ('Curl alternado con mancuernas',   'Bíceps', array[]::text[], 'Mancuernas', 'weight_reps'),
  ('Curl en polea',                   'Bíceps', array[]::text[], 'Polea', 'weight_reps'),
  ('Curl concentrado',                'Bíceps', array[]::text[], 'Mancuerna', 'weight_reps'),
  -- Tríceps
  ('Press francés',                   'Tríceps', array[]::text[], 'Barra Z / mancuernas', 'weight_reps'),
  ('Patada de tríceps',               'Tríceps', array[]::text[], 'Mancuerna / polea', 'weight_reps'),
  ('Fondos en banco',                 'Tríceps', array['Pecho','Hombros'], 'Peso corporal', 'weight_reps'),
  ('Press banca agarre cerrado',      'Tríceps', array['Pecho'], 'Barra', 'weight_reps'),
  -- Cuádriceps
  ('Sentadilla con barra',            'Cuádriceps', array['Glúteos','Isquiotibiales'], 'Barra', 'weight_reps'),
  ('Sentadilla hack',                 'Cuádriceps', array['Glúteos'], 'Máquina', 'weight_reps'),
  ('Sentadilla goblet',               'Cuádriceps', array['Glúteos'], 'Mancuerna / pesa rusa', 'weight_reps'),
  ('Sentadilla búlgara',              'Cuádriceps', array['Glúteos'], 'Mancuernas', 'weight_reps'),
  ('Estocadas / Zancadas',            'Cuádriceps', array['Glúteos'], 'Mancuernas', 'weight_reps'),
  -- Isquiotibiales
  ('Peso muerto rumano',              'Isquiotibiales', array['Glúteos','Espalda'], 'Barra / mancuernas', 'weight_reps'),
  ('Curl femoral sentado',            'Isquiotibiales', array[]::text[], 'Máquina', 'weight_reps'),
  ('Buenos días',                     'Isquiotibiales', array['Glúteos','Espalda'], 'Barra', 'weight_reps'),
  -- Glúteos
  ('Hip thrust',                      'Glúteos', array['Isquiotibiales'], 'Barra / máquina', 'weight_reps'),
  ('Patada de glúteo en polea',       'Glúteos', array['Isquiotibiales'], 'Polea', 'weight_reps'),
  ('Abducción en máquina',            'Glúteos', array[]::text[], 'Máquina', 'weight_reps'),
  -- Aductores
  ('Aducción en máquina',             'Aductores', array[]::text[], 'Máquina', 'weight_reps'),
  -- Gemelos
  ('Gemelos sentado',                 'Gemelos', array[]::text[], 'Máquina', 'weight_reps'),
  ('Gemelos en prensa',               'Gemelos', array[]::text[], 'Prensa', 'weight_reps'),
  -- Abdominales
  ('Plancha lateral',                 'Abdominales', array[]::text[], 'Peso corporal', 'duration'),
  ('Crunch abdominal',                'Abdominales', array[]::text[], 'Peso corporal', 'weight_reps'),
  ('Crunch en polea',                 'Abdominales', array[]::text[], 'Polea', 'weight_reps'),
  ('Elevación de piernas',            'Abdominales', array[]::text[], 'Peso corporal', 'weight_reps'),
  ('Rueda abdominal',                 'Abdominales', array[]::text[], 'Peso corporal', 'weight_reps')
) as v(name, muscle, secondary, equipment, mtype)
where not exists (select 1 from public.exercises e where lower(e.name) = lower(v.name));
