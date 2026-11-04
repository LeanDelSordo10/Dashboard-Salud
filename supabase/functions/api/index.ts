// Dashboard Salud — API (Supabase Edge Function).
//
// Única puerta de acceso a los datos. La base está cerrada (RLS sin políticas y
// sin permisos para anon/authenticated); esta función valida la sesión del
// usuario, comprueba que su email sea el autorizado y recién entonces usa la
// service role (inyectada por Supabase, nunca expuesta) para leer o escribir.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ALLOWED_EMAIL = (Deno.env.get('ALLOWED_EMAIL') ?? '').trim().toLowerCase();
const TZ = 'America/Argentina/Buenos_Aires';
const ALLOWED_ORIGINS = ['https://leandelsordo10.github.io'];
const DAY_CODES = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- utilidades

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function q<T = any>(promise: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

/** Lee todas las filas de una consulta, de a 1000 (límite de PostgREST). */
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await q<any[]>(build(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Fecha de hoy (YYYY-MM-DD) en Buenos Aires, sin importar la zona del servidor. */
function todayBA(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
}
/** Lunes de la semana de `day`. */
function weekStart(day: string): string {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

const PERIODS: Record<string, number> = { week: 7, month: 30, quarter: 90, year: 365, all: 3650 };
function periodRange(period: string, offset = 0) {
  const days = PERIODS[period] ?? 30;
  const end = addDays(todayBA(), -offset * days);
  return { days, start: addDays(end, -(days - 1)), end };
}

const pct = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : ((cur - prev) * 100) / Math.abs(prev);
const avg = (vals: (number | null)[]) => {
  const v = vals.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const e1rm = (w: number | null, r: number | null) => (w && r ? w * (1 + r / 30) : null);
const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ------------------------------------------------- catálogo y series unificadas

// Nombres de ejercicios de Garmin -> nombre del catálogo (para unir el historial).
const GARMIN_ALIAS: Record<string, string> = {
  'prensa': 'Press de piernas', 'curl femoral': 'Curl femoral', 'sentadilla sumo': 'Sentadilla sumo',
  'glúteos máquina': 'Máquina de glúteos', 'gemelos': 'Gemelos de pie', 'plancha': 'Plancha',
  'press banca con barra': 'Press banca', 'jalón al pecho en polea': 'Jalón al pecho',
  'remo en máquina': 'Remo en máquina', 'remo máquina/polea': 'Remo en máquina',
  'mariposa / pec deck': 'Pec deck / Mariposa', 'press hombros máquina': 'Press de hombros con mancuerna',
  'vuelos laterales': 'Vuelos laterales', 'curl martillo': 'Curl martillo', 'tríceps polea': 'Tríceps en polea',
  'press inclinado máquina': 'Press inclinado en máquina', 'tracción vertical': 'Tracción vertical',
  'cruce de poleas': 'Cruce de poleas', 'press militar': 'Press militar', 'curl inclinado': 'Curl inclinado',
  'tríceps trasnuca': 'Tríceps sobre cabeza',
};
// Ejercicios de Garmin sin equivalente en el catálogo.
const GARMIN_EXTRA: Record<string, { muscle: string; secondary: string[] }> = {
  'deltoides posterior': { muscle: 'Hombros', secondary: ['Espalda'] },
  'aductores': { muscle: 'Aductores', secondary: [] },
};

type Exercise = { id: string; name: string; primary_muscle: string | null; secondary_muscles: string[]; equipment: string | null; measurement_type: string; active: boolean };
type UnifiedSet = {
  source: 'manual' | 'garmin'; session_id: string; date: string; title: string;
  exercise_key: string; exercise_id: string | null; exercise: string; muscle: string; secondary: string[];
  set_number: number; weight_kg: number | null; reps: number | null; duration_s: number | null;
};

async function loadCatalog() {
  const rows = await q<Exercise[]>(db.from('exercises').select('id,name,primary_muscle,secondary_muscles,equipment,measurement_type,active').order('name'));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const byName = new Map(rows.map((e) => [e.name.toLowerCase(), e]));
  return { rows, byId, byName };
}

/** Todas las series (manuales + Garmin) entre fechas, normalizadas a un mismo formato. */
async function loadSets(start: string, end: string, cat?: Awaited<ReturnType<typeof loadCatalog>>): Promise<UnifiedSet[]> {
  cat ??= await loadCatalog();
  // Se leen las vistas de historial por rango de fechas, paginando de a 1000 filas.
  const [manual, garmin] = await Promise.all([
    fetchAll((from, to) => db.from('workout_set_history').select('id,session_id,session_title,performed_at,exercise_id,set_number,weight_kg,reps,duration_s')
      .gte('performed_at', start).lte('performed_at', end).order('id').range(from, to)),
    fetchAll((from, to) => db.from('garmin_set_history').select('id,import_id,session_title,performed_at,set_number,set_type,exercise_name_garmin,duration_s,reps,weight_kg')
      .gte('performed_at', start).lte('performed_at', end).order('id').range(from, to)),
  ]);
  const out: UnifiedSet[] = [];
  for (const s of manual) {
    const ex = cat.byId.get(s.exercise_id);
    // Ejercicios por tiempo (plancha): los registros viejos guardaban los segundos en
    // weight_kg. Se normalizan a duration_s para no inflar volumen ni e1RM.
    const timed = ex?.measurement_type === 'duration';
    out.push({
      source: 'manual', session_id: s.session_id, date: s.performed_at, title: s.session_title,
      exercise_key: s.exercise_id, exercise_id: s.exercise_id, exercise: ex?.name ?? 'Ejercicio',
      muscle: ex?.primary_muscle ?? 'Sin clasificar', secondary: ex?.secondary_muscles ?? [],
      set_number: s.set_number,
      weight_kg: timed ? null : num(s.weight_kg), reps: timed ? null : num(s.reps),
      duration_s: timed ? (num(s.duration_s) ?? num(s.weight_kg)) : num(s.duration_s),
    });
  }
  for (const s of garmin) {
    const name = String(s.exercise_name_garmin ?? '').trim();
    const key = name.toLowerCase();
    const reps = num(s.reps);
    const isPlank = key === 'plancha';
    // Se descartan descansos, registros vacíos de Garmin (0 reps) y "Registro extra".
    if (String(s.set_type ?? '').toLowerCase() !== 'active' || key.startsWith('registro extra') || (!isPlank && !reps)) continue;
    const ex = GARMIN_ALIAS[key] ? cat.byName.get(GARMIN_ALIAS[key].toLowerCase()) : undefined;
    const extra = GARMIN_EXTRA[key];
    out.push({
      source: 'garmin', session_id: s.import_id, date: s.performed_at, title: s.session_title ?? 'Fuerza',
      exercise_key: ex?.id ?? 'g:' + key, exercise_id: ex?.id ?? null, exercise: ex?.name ?? name,
      muscle: ex?.primary_muscle ?? extra?.muscle ?? 'Sin clasificar', secondary: ex?.secondary_muscles ?? extra?.secondary ?? [],
      set_number: s.set_number, weight_kg: num(s.weight_kg), reps, duration_s: num(s.duration_s),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.set_number - b.set_number);
  return out;
}

function exerciseStats(sets: UnifiedSet[]) {
  const map = new Map<string, any>();
  for (const s of sets) {
    const st = map.get(s.exercise_key) ?? { exercise_key: s.exercise_key, exercise_id: s.exercise_id, name: s.exercise, muscle: s.muscle, sets: 0, reps: 0, volume: 0, best_e1rm: null as number | null, top_weight: null as number | null, sessions: new Set<string>() };
    st.sets += 1; st.reps += s.reps ?? 0; st.volume += (s.weight_kg ?? 0) * (s.reps ?? 0);
    const e = e1rm(s.weight_kg, s.reps);
    if (e !== null && (st.best_e1rm === null || e > st.best_e1rm)) st.best_e1rm = e;
    if (s.weight_kg !== null && (st.top_weight === null || s.weight_kg > st.top_weight)) st.top_weight = s.weight_kg;
    st.sessions.add(s.session_id);
    map.set(s.exercise_key, st);
  }
  return [...map.values()].map((x) => ({ ...x, sessions: x.sessions.size, best_e1rm: round(x.best_e1rm), volume: Math.round(x.volume) }))
    .sort((a, b) => b.volume - a.volume);
}

function muscleLoad(sets: UnifiedSet[]) {
  const m = new Map<string, { muscle: string; sets: number; volume: number }>();
  const add = (name: string, w: number, vol: number) => {
    const x = m.get(name) ?? { muscle: name, sets: 0, volume: 0 };
    x.sets += w; x.volume += vol; m.set(name, x);
  };
  for (const s of sets) {
    const vol = (s.weight_kg ?? 0) * (s.reps ?? 0);
    add(s.muscle, 1, vol);
    for (const sec of s.secondary) add(sec, 0.5, vol * 0.5);
  }
  return [...m.values()].map((x) => ({ ...x, volume: Math.round(x.volume) })).sort((a, b) => b.sets - a.sets);
}

function sessionList(sets: UnifiedSet[]) {
  const m = new Map<string, any>();
  for (const s of sets) {
    const k = s.source + ':' + s.session_id;
    const x = m.get(k) ?? { kind: s.source, id: s.session_id, date: s.date, title: s.title, sets: 0, volume: 0, exercises: new Set<string>() };
    x.sets += 1; x.volume += (s.weight_kg ?? 0) * (s.reps ?? 0); x.exercises.add(s.exercise_key);
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ ...x, exercises: x.exercises.size, volume: Math.round(x.volume) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Progreso de e1RM entre dos períodos, sobre ejercicios presentes en ambos.
 * Se usa la mediana (no el promedio) para que un ejercicio con un cambio de
 * carga atípico (p. ej. pasar a contar el peso corporal) no distorsione el total.
 */
function strengthProgress(cur: UnifiedSet[], prev: UnifiedSet[]) {
  const c = new Map(exerciseStats(cur).map((x) => [x.exercise_key, x]));
  const changes: number[] = [];
  for (const p of exerciseStats(prev)) {
    const x = c.get(p.exercise_key);
    const ch = x ? pct(x.best_e1rm, p.best_e1rm) : null;
    if (ch !== null) changes.push(ch);
  }
  if (!changes.length) return null;
  changes.sort((a, b) => a - b);
  const mid = Math.floor(changes.length / 2);
  return changes.length % 2 ? changes[mid] : (changes[mid - 1] + changes[mid]) / 2;
}

function weeklyVolume(sets: UnifiedSet[], weeks: number) {
  const end = weekStart(todayBA());
  const buckets = new Map<string, { week: string; volume: number; sets: number; sessions: Set<string> }>();
  for (let i = weeks - 1; i >= 0; i--) {
    const w = addDays(end, -7 * i);
    buckets.set(w, { week: w, volume: 0, sets: 0, sessions: new Set() });
  }
  for (const s of sets) {
    const b = buckets.get(weekStart(s.date));
    if (!b) continue;
    b.volume += (s.weight_kg ?? 0) * (s.reps ?? 0); b.sets += 1; b.sessions.add(s.source + s.session_id);
  }
  return [...buckets.values()].map((b) => ({ week: b.week, volume: Math.round(b.volume), sets: b.sets, sessions: b.sessions.size }));
}

// ------------------------------------------------------------- peso y salud

async function loadWeights() {
  return (await fetchAll((f, t) => db.from('body_weight_records').select('id,measurement_date,weight_kg,notes').order('measurement_date').range(f, t)))
    .map((r) => ({ id: r.id, date: r.measurement_date, weight_kg: num(r.weight_kg)!, notes: r.notes }));
}
async function loadGoals() {
  const rows = await q<any[]>(db.from('dashboard_goals').select('*').eq('id', 1).limit(1));
  return rows[0] ?? { id: 1 };
}

/** Pendiente (kg/semana) por regresión lineal sobre los registros de los últimos `days` días. */
function weightTrend(weights: { date: string; weight_kg: number }[], days = 56) {
  if (!weights.length) return null;
  const last = weights[weights.length - 1].date;
  const pts = weights.filter((w) => diffDays(last, w.date) <= days);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => diffDays(p.date, pts[0].date)); const ys = pts.map((p) => p.weight_kg);
  const mx = avg(xs)!, my = avg(ys)!;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!den) return null;
  return (xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 7;
}

function weightSummary(weights: { date: string; weight_kg: number }[], target: number | null) {
  if (!weights.length) return { latest: null, records: 0 };
  const latest = weights[weights.length - 1];
  const first = weights[0];
  const ref = [...weights].reverse().find((w) => diffDays(latest.date, w.date) >= 28) ?? first;
  const slope = weightTrend(weights);
  const remaining = target !== null ? latest.weight_kg - target : null;
  let eta_weeks: number | null = null;
  if (remaining !== null && slope !== null && slope < 0 && remaining > 0) eta_weeks = Math.ceil(remaining / -slope);
  return {
    latest, first, records: weights.length,
    change_4w: round(latest.weight_kg - ref.weight_kg, 2), change_4w_from: ref.date,
    change_total: round(latest.weight_kg - first.weight_kg, 2),
    trend_kg_week: round(slope, 2), target, remaining: round(remaining, 2), eta_weeks,
    days_since: diffDays(todayBA(), latest.date),
  };
}

async function loadHealth(start: string, end: string) {
  const [rows, validated] = await Promise.all([
    fetchAll((f, t) => db.from('daily_health').select('date,steps,distance_m,active_seconds,active_calories,sleep_seconds,hrv_rmssd,resting_hr').gte('date', start).lte('date', end).order('date').range(f, t)),
    fetchAll((f, t) => db.from('garmin_daily_validated').select('date,steps').gte('date', start).lte('date', end).order('date').range(f, t)),
  ]);
  const v = new Map(validated.map((x) => [x.date, num(x.steps)]));
  // Los pasos validados contra Garmin Connect tienen prioridad sobre los calculados.
  return rows.map((r) => ({
    date: r.date, steps: v.get(r.date) ?? num(r.steps), distance_m: num(r.distance_m), active_seconds: num(r.active_seconds),
    active_calories: num(r.active_calories), sleep_seconds: num(r.sleep_seconds), hrv_rmssd: num(r.hrv_rmssd), resting_hr: num(r.resting_hr),
  }));
}

function latestOf(rows: any[], field: string) {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][field] !== null) return { value: rows[i][field], date: rows[i].date };
  return null;
}

// --------------------------------------------------------------- endpoints

async function overview() {
  const today = todayBA();
  const cat = await loadCatalog();
  const [weights, goals, sets, health, openSessions] = await Promise.all([
    loadWeights(), loadGoals(), loadSets(addDays(today, -7 * 12), today, cat),
    loadHealth('2000-01-01', today),
    q<any[]>(db.from('workout_sessions').select('id,date,title').eq('status', 'open').lt('date', today).order('date', { ascending: false })),
  ]);
  const wk = weekStart(today);
  const weekSessions = sessionList(sets.filter((s) => s.date >= wk));
  const sessions = sessionList(sets);
  const last = sessions[0] ?? null;
  const lastSets = last ? sets.filter((s) => s.session_id === last.id) : [];
  const recent28 = sets.filter((s) => diffDays(today, s.date) < 28);
  const prev28 = sets.filter((s) => diffDays(today, s.date) >= 28 && diffDays(today, s.date) < 56);
  return {
    today,
    goals,
    weight: { ...weightSummary(weights, num(goals.target_weight_kg)), series: weights.map((w) => ({ date: w.date, weight_kg: w.weight_kg })) },
    week: { start: wk, sessions: weekSessions.length, goal: num(goals.weekly_strength_sessions_goal) ?? 4, list: weekSessions },
    last_session: last ? { ...last, muscles: muscleLoad(lastSets), exercises: exerciseStats(lastSets).map((e) => ({ name: e.name, sets: e.sets, top_weight: e.top_weight })) } : null,
    strength: {
      weekly: weeklyVolume(sets, 8),
      sessions_28d: sessionList(recent28).length,
      volume_28d: Math.round(recent28.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)),
      volume_change_pct: round(pct(recent28.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), prev28.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0) || null)),
      progress_pct: round(strengthProgress(recent28, prev28)),
    },
    health: {
      steps: latestOf(health, 'steps'), sleep_seconds: latestOf(health, 'sleep_seconds'),
      hrv_rmssd: latestOf(health, 'hrv_rmssd'), resting_hr: latestOf(health, 'resting_hr'),
    },
    open_sessions: openSessions,
  };
}

async function strength(period: string) {
  const cur = periodRange(period), prev = periodRange(period, 1);
  const cat = await loadCatalog();
  const [sets, prevSets, allSets] = await Promise.all([
    loadSets(cur.start, cur.end, cat), loadSets(prev.start, prev.end, cat), loadSets('2000-01-01', cur.end, cat),
  ]);
  const stats = exerciseStats(sets);
  const prevStats = new Map(exerciseStats(prevSets).map((x) => [x.exercise_key, x]));
  for (const x of stats as any[]) x.e1rm_change_pct = round(pct(x.best_e1rm, prevStats.get(x.exercise_key)?.best_e1rm ?? null));
  // Evolución por ejercicio: mejor e1RM y peso máximo de cada sesión (historial completo).
  const series: Record<string, { name: string; muscle: string; points: any[] }> = {};
  const bySession = new Map<string, any>();
  for (const s of allSets) {
    const k = s.exercise_key + '|' + s.source + s.session_id;
    const p = bySession.get(k) ?? { key: s.exercise_key, name: s.exercise, muscle: s.muscle, date: s.date, source: s.source, e1rm: null, top_weight: null, volume: 0 };
    const e = e1rm(s.weight_kg, s.reps);
    if (e !== null && (p.e1rm === null || e > p.e1rm)) p.e1rm = e;
    if (s.weight_kg !== null && (p.top_weight === null || s.weight_kg > p.top_weight)) p.top_weight = s.weight_kg;
    p.volume += (s.weight_kg ?? 0) * (s.reps ?? 0);
    bySession.set(k, p);
  }
  for (const p of bySession.values()) {
    (series[p.key] ??= { name: p.name, muscle: p.muscle, points: [] }).points.push({ date: p.date, source: p.source, e1rm: round(p.e1rm), top_weight: p.top_weight, volume: Math.round(p.volume) });
  }
  for (const s of Object.values(series)) s.points.sort((a, b) => a.date.localeCompare(b.date));
  const volume = sets.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const prevVolume = prevSets.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  return {
    period, start: cur.start, end: cur.end,
    metrics: {
      sessions: sessionList(sets).length, sets: sets.length, reps: sets.reduce((a, s) => a + (s.reps ?? 0), 0),
      volume: Math.round(volume), volume_change_pct: round(pct(volume, prevVolume || null)),
      progress_pct: round(strengthProgress(sets, prevSets)),
    },
    exercise_stats: stats,
    muscles: muscleLoad(sets),
    sessions: sessionList(sets),
    weekly: weeklyVolume(allSets, period === 'week' ? 8 : Math.min(52, Math.max(8, Math.ceil((PERIODS[period] ?? 30) / 7)))),
    series,
  };
}

async function sessionDetail(kind: string, id: string) {
  if (!UUID_RE.test(id) || !['manual', 'garmin'].includes(kind)) throw new HttpError(400, 'Sesión inválida');
  const table = kind === 'manual' ? 'workout_sessions' : 'garmin_strength_imports';
  const rows = await q<any[]>(db.from(table).select('*').eq('id', id).limit(1));
  if (!rows.length) throw new HttpError(404, 'No se encontró el entrenamiento');
  const ses = rows[0];
  const sets = (await loadSets(ses.date, ses.date)).filter((s) => s.session_id === id);
  const groups = new Map<string, any>();
  for (const s of sets) {
    const g = groups.get(s.exercise_key) ?? { name: s.exercise, muscle: s.muscle, sets: [] as any[] };
    g.sets.push({ set_number: s.set_number, weight_kg: s.weight_kg, reps: s.reps, duration_s: kind === 'garmin' ? round(s.duration_s, 0) : s.duration_s });
    groups.set(s.exercise_key, g);
  }
  const exercises = [...groups.values()].map((g) => ({
    ...g, set_count: g.sets.length,
    volume: Math.round(g.sets.reduce((a: number, s: any) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)),
    best: round(Math.max(0, ...g.sets.map((s: any) => e1rm(s.weight_kg, s.reps) ?? 0)) || null),
  }));
  return {
    kind, id, date: ses.date, title: ses.title ?? 'Fuerza', status: ses.status ?? 'completed',
    metrics: {
      sets: sets.length, reps: sets.reduce((a, s) => a + (s.reps ?? 0), 0),
      volume: Math.round(sets.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)),
      duration_s: num(ses.duration_s), calories: num(ses.calories), hr_avg: num(ses.hr_avg), hr_max: num(ses.hr_max),
    },
    exercises, muscles: muscleLoad(sets),
  };
}

async function globalEvolution(period: string) {
  const cur = periodRange(period), prev = periodRange(period, 1);
  const cat = await loadCatalog();
  const [sets, prevSets, weights, goals, health, prevHealth] = await Promise.all([
    loadSets(cur.start, cur.end, cat), loadSets(prev.start, prev.end, cat), loadWeights(), loadGoals(),
    loadHealth(cur.start, cur.end), loadHealth(prev.start, prev.end),
  ]);
  const wIn = (s: string, e: string) => weights.filter((w) => w.date >= s && w.date <= e);
  const wCur = wIn(cur.start, cur.end), wPrevAll = weights.filter((w) => w.date < cur.start);
  const weightDelta = wCur.length && (wPrevAll.length || wCur.length > 1)
    ? wCur[wCur.length - 1].weight_kg - (wPrevAll.length ? wPrevAll[wPrevAll.length - 1].weight_kg : wCur[0].weight_kg) : null;
  const sessions = sessionList(sets).length;
  const goal = num(goals.weekly_strength_sessions_goal) ?? 4;
  const expected = Math.max(1, Math.round((goal * cur.days) / 7));
  const vol = (x: UnifiedSet[]) => x.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const metric = (rows: any[], f: string) => avg(rows.map((r) => r[f]));
  const m = {
    sessions, sessions_expected: expected, consistency_pct: round(Math.min(100, (sessions * 100) / expected)),
    strength_pct: round(strengthProgress(sets, prevSets)), volume_pct: round(pct(vol(sets), vol(prevSets) || null)),
    weight_delta_kg: round(weightDelta, 2),
    steps_avg: round(metric(health, 'steps'), 0), steps_pct: round(pct(metric(health, 'steps'), metric(prevHealth, 'steps'))),
    sleep_avg_s: round(metric(health, 'sleep_seconds'), 0), sleep_pct: round(pct(metric(health, 'sleep_seconds'), metric(prevHealth, 'sleep_seconds'))),
    hrv_avg: round(metric(health, 'hrv_rmssd')), rhr_avg: round(metric(health, 'resting_hr')),
  };
  const good: string[] = [], warn: string[] = [];
  if (m.strength_pct !== null) (m.strength_pct >= 0 ? good : warn).push(m.strength_pct >= 0 ? `tu fuerza estimada subió ${m.strength_pct.toLocaleString('es-AR')} %` : `tu fuerza estimada bajó ${Math.abs(m.strength_pct).toLocaleString('es-AR')} %`);
  if (m.weight_delta_kg !== null) (m.weight_delta_kg <= 0 ? good : warn).push(m.weight_delta_kg <= 0 ? `bajaste ${Math.abs(m.weight_delta_kg).toLocaleString('es-AR')} kg` : `subiste ${m.weight_delta_kg.toLocaleString('es-AR')} kg`);
  if (m.consistency_pct !== null) (m.consistency_pct >= 75 ? good : warn).push(`cumpliste ${sessions} de ${expected} entrenamientos previstos`);
  return {
    period, start: cur.start, end: cur.end, metrics: m, conclusion: { good, warn },
    weekly: weeklyVolume(await loadSets(addDays(cur.end, -7 * 26), cur.end, cat), Math.min(26, Math.max(4, Math.ceil(cur.days / 7)))),
    weights: weights.filter((w) => w.date >= addDays(cur.start, -cur.days)),
    target_weight: num(goals.target_weight_kg),
  };
}

/** Sugiere la rutina del día: la ya iniciada en esa fecha o la que sigue a la última sesión. */
async function suggestDay(date: string) {
  const same = await q<any[]>(db.from('workout_sessions').select('title').eq('date', date).order('created_at', { ascending: false }).limit(1));
  if (same.length && DAY_CODES.includes(same[0].title)) return same[0].title;
  const prev = await q<any[]>(db.from('workout_sessions').select('title').lt('date', date).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1));
  const last = prev[0]?.title as string | undefined;
  if (!last || !DAY_CODES.includes(last)) return 'Upper A';
  const [kind, letter] = last.split(' ');
  return `${kind === 'Upper' ? 'Lower' : 'Upper'} ${letter}`;
}

async function workoutToday(day: string, date: string) {
  if (day === 'auto') day = await suggestDay(date);
  if (!DAY_CODES.includes(day)) throw new HttpError(400, 'Rutina inválida');
  const cat = await loadCatalog();
  const routines = await q<any[]>(db.from('routine_templates').select('id').eq('active', true).order('created_at').limit(1));
  if (!routines.length) return { day, date, session: null, items: [], catalog: [] };
  // Antes de mostrar la rutina se sincronizan los objetivos con las últimas 3 sesiones
  // (por si se cargaron o corrigieron entrenamientos desde otra pantalla).
  const planned = await q<any[]>(db.from('routine_exercises').select('exercise_id').eq('routine_id', routines[0].id).eq('day_code', day));
  await Promise.all(planned.map((p) => autoUpdateTarget(day, p.exercise_id).catch((err) => console.error('autoUpdateTarget', err))));
  const items = await q<any[]>(db.from('routine_exercises').select('id,position,exercise_id,target_sets,target_reps_min,target_reps_max,target_weight_kg,notes').eq('routine_id', routines[0].id).eq('day_code', day).order('position'));
  // Último ajuste automático de objetivo de cada ejercicio (últimas 3 semanas).
  const changes = items.length ? await q<any[]>(db.from('routine_target_changes').select('routine_exercise_id,changed_at,before,after')
    .in('routine_exercise_id', items.map((i) => i.id)).gte('changed_at', new Date(Date.now() - 21 * 86400000).toISOString())
    .order('changed_at', { ascending: false })) : [];
  const changeBy = new Map<number, any>();
  for (const c of changes) if (!changeBy.has(c.routine_exercise_id)) changeBy.set(c.routine_exercise_id, c);
  const sessions = await q<any[]>(db.from('workout_sessions').select('id,date,title,status').eq('date', date).eq('title', day).order('created_at', { ascending: false }).limit(1));
  const session = sessions[0] ?? null;
  const saved = session ? await q<any[]>(db.from('workout_sets').select('exercise_id,planned_exercise_id,set_number,weight_kg,reps,duration_s').eq('session_id', session.id).order('set_number')) : [];
  // Último registro real de cada ejercicio (antes de esta fecha), con todas sus series.
  const ids = [...new Set(items.map((i) => i.exercise_id))];
  const history = ids.length ? await q<any[]>(db.from('workout_set_history').select('exercise_id,performed_at,set_number,weight_kg,reps,session_id').in('exercise_id', ids).lt('performed_at', date).order('performed_at', { ascending: false }).order('set_number').limit(1000)) : [];
  const setOut = (exId: string, s: any) => cat.byId.get(exId)?.measurement_type === 'duration'
    ? { duration_s: num(s.duration_s) ?? num(s.weight_kg) }
    : { weight_kg: num(s.weight_kg), reps: num(s.reps) };
  const lastBy = new Map<string, { date: string; sets: any[]; session: string }>();
  for (const h of history) {
    const cur = lastBy.get(h.exercise_id);
    if (!cur) lastBy.set(h.exercise_id, { date: h.performed_at, sets: [setOut(h.exercise_id, h)], session: h.session_id });
    else if (cur.session === h.session_id) cur.sets.push(setOut(h.exercise_id, h));
  }
  return {
    day, date, session,
    items: items.map((i) => {
      const ex = cat.byId.get(i.exercise_id);
      const mine = saved.filter((s) => (s.planned_exercise_id ?? s.exercise_id) === i.exercise_id);
      const last = lastBy.get(i.exercise_id);
      return {
        position: i.position, exercise_id: i.exercise_id, name: ex?.name ?? 'Ejercicio', muscle: ex?.primary_muscle ?? null,
        measurement_type: ex?.measurement_type ?? 'weight_reps',
        target: { sets: i.target_sets, reps_min: i.target_reps_min, reps_max: i.target_reps_max, weight_kg: num(i.target_weight_kg) },
        target_change: changeBy.get(i.id) ?? null,
        last: last ? { date: last.date, sets: last.sets } : null,
        saved: mine.length ? { exercise_id: mine[0].exercise_id, sets: mine.map((s) => setOut(mine[0].exercise_id, s)) } : null,
      };
    }),
    catalog: cat.rows.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, muscle: e.primary_muscle, measurement_type: e.measurement_type })),
  };
}

// ------------------------------------------- objetivos que se ajustan solos

const SESSIONS_TO_CONFIRM = 3;

/** Resumen de lo hecho en un ejercicio durante una sesión. */
function sessionSummary(sets: any[], timed: boolean) {
  if (timed) return { sets: sets.length, weight: null, reps: null };
  const withWeight = sets.filter((s) => num(s.weight_kg) !== null);
  const top = withWeight.length ? Math.max(...withWeight.map((s) => num(s.weight_kg)!)) : null;
  // Repeticiones logradas con el peso de trabajo (el más alto): se toma la menor,
  // así el objetivo refleja lo que se logró en TODAS las series con ese peso.
  const atTop = top === null ? sets : withWeight.filter((s) => num(s.weight_kg) === top);
  const reps = atTop.map((s) => num(s.reps)).filter((r): r is number => r !== null && r > 0);
  return { sets: sets.length, weight: top, reps: reps.length ? Math.min(...reps) : null };
}

/**
 * Si en las últimas 3 sesiones de un día de rutina (p. ej. "Upper A") el ejercicio
 * se hizo con el mismo peso, las mismas repeticiones o la misma cantidad de series,
 * ese valor pasa a ser el nuevo objetivo. Cada dato se evalúa por separado.
 * Devuelve el cambio aplicado (o null) y lo deja registrado en routine_target_changes.
 */
async function autoUpdateTarget(day: string, exerciseId: string) {
  const routines = await q<any[]>(db.from('routine_templates').select('id').eq('active', true).order('created_at').limit(1));
  if (!routines.length) return null;
  const items = await q<any[]>(db.from('routine_exercises').select('id,target_sets,target_reps_min,target_reps_max,target_weight_kg')
    .eq('routine_id', routines[0].id).eq('day_code', day).eq('exercise_id', exerciseId).limit(1));
  if (!items.length) return null;
  const item = items[0];
  const ex = await q<any[]>(db.from('exercises').select('measurement_type').eq('id', exerciseId).limit(1));
  const timed = ex[0]?.measurement_type === 'duration';
  // Series del ejercicio tal como estaba planificado (no cuentan los cambios de máquina).
  const rows = await q<any[]>(db.from('workout_set_history').select('session_id,performed_at,set_number,weight_kg,reps')
    .eq('exercise_id', exerciseId).eq('planned_exercise_id', exerciseId).eq('session_title', day)
    .order('performed_at', { ascending: false }).order('set_number').limit(300));
  const bySession = new Map<string, { date: string; sets: any[] }>();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) {
      if (bySession.size === SESSIONS_TO_CONFIRM) break;
      bySession.set(r.session_id, { date: r.performed_at, sets: [] });
    }
    bySession.get(r.session_id)!.sets.push(r);
  }
  if (bySession.size < SESSIONS_TO_CONFIRM) return null;
  const sums = [...bySession.values()].map((s) => sessionSummary(s.sets, timed));
  const same = (k: 'sets' | 'weight' | 'reps') => sums.every((s) => s[k] !== null && s[k] === sums[0][k]) ? sums[0][k] : null;
  const sets = same('sets'), weight = same('weight'), reps = same('reps');

  const before = { sets: item.target_sets, reps_min: item.target_reps_min, reps_max: item.target_reps_max, weight_kg: num(item.target_weight_kg) };
  const after = { ...before };
  if (sets !== null) after.sets = sets;
  if (!timed && weight !== null) after.weight_kg = weight;
  if (!timed && reps !== null) { after.reps_min = reps; after.reps_max = reps; }
  if (JSON.stringify(after) === JSON.stringify(before)) return null;

  await q(db.from('routine_exercises').update({
    target_sets: after.sets, target_reps_min: after.reps_min, target_reps_max: after.reps_max, target_weight_kg: after.weight_kg,
  }).eq('id', item.id));
  const sessions = [...bySession.entries()].map(([id, s], i) => ({ id, date: s.date, ...sums[i] }));
  await q(db.from('routine_target_changes').insert({ routine_exercise_id: item.id, before, after, sessions }));
  return { before, after };
}

/** Guarda el nuevo orden de los ejercicios de un día de la rutina. */
async function saveRoutineOrder(body: any) {
  const day = String(body?.day ?? '');
  if (!DAY_CODES.includes(day)) throw new HttpError(400, 'Rutina inválida');
  const ids: string[] = Array.isArray(body?.exercise_ids) ? body.exercise_ids.map(String) : [];
  if (!ids.length || ids.length > 30 || ids.some((x) => !UUID_RE.test(x)) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Orden inválido');
  const routines = await q<any[]>(db.from('routine_templates').select('id').eq('active', true).order('created_at').limit(1));
  if (!routines.length) throw new HttpError(404, 'No hay rutina activa');
  const rows = await q<any[]>(db.from('routine_exercises').select('id,exercise_id').eq('routine_id', routines[0].id).eq('day_code', day));
  const current = new Set(rows.map((r) => r.exercise_id));
  if (rows.length !== ids.length || ids.some((x) => !current.has(x))) throw new HttpError(409, 'La rutina cambió. Recargá la página.');
  const byEx = new Map(rows.map((r) => [r.exercise_id, r.id]));
  await Promise.all(ids.map((exId, i) => q(db.from('routine_exercises').update({ position: i + 1 }).eq('id', byEx.get(exId)))));
  return { ok: true };
}

async function createOrResumeWorkout(body: any) {
  const title = String(body?.title ?? '');
  const date = String(body?.date ?? todayBA());
  if (!DAY_CODES.includes(title)) throw new HttpError(400, 'Rutina inválida');
  if (!DATE_RE.test(date) || date > addDays(todayBA(), 1)) throw new HttpError(400, 'Fecha inválida');
  const existing = await q<any[]>(db.from('workout_sessions').select('id,date,title,status').eq('date', date).eq('title', title).order('created_at', { ascending: false }).limit(1));
  if (existing.length) return existing[0];
  return (await q<any[]>(db.from('workout_sessions').insert({ date, title, status: 'open', source: 'manual' }).select('id,date,title,status')))[0];
}

async function saveExerciseSets(sid: string, body: any) {
  if (!UUID_RE.test(sid)) throw new HttpError(400, 'Sesión inválida');
  const exerciseId = String(body?.exercise_id ?? ''), planned = String(body?.planned_exercise_id ?? '');
  if (!UUID_RE.test(exerciseId) || !UUID_RE.test(planned)) throw new HttpError(400, 'Ejercicio inválido');
  const ses = await q<any[]>(db.from('workout_sessions').select('id,title').eq('id', sid).limit(1));
  if (!ses.length) throw new HttpError(404, 'La sesión no existe');
  const ex = await q<any[]>(db.from('exercises').select('id,measurement_type').eq('id', exerciseId).limit(1));
  if (!ex.length) throw new HttpError(400, 'Ejercicio inválido');
  const timed = ex[0].measurement_type === 'duration';
  const raw = Array.isArray(body?.sets) ? body.sets.slice(0, 20) : [];
  const rows = [];
  for (const s of raw) {
    if (timed) {
      const d = num(s?.duration_s);
      if (d === null) continue;
      if (d <= 0 || d > 3600) throw new HttpError(400, 'La duración debe estar entre 1 y 3600 segundos');
      rows.push({ session_id: sid, exercise_id: exerciseId, planned_exercise_id: planned, set_number: rows.length + 1, weight_kg: null, reps: null, duration_s: Math.round(d) });
      continue;
    }
    const w = num(s?.weight_kg), r = num(s?.reps);
    if (w === null && r === null) continue;
    if (w !== null && (w < 0 || w > 500)) throw new HttpError(400, 'El peso de cada serie debe estar entre 0 y 500 kg');
    if (r !== null && (!Number.isInteger(r) || r < 0 || r > 300)) throw new HttpError(400, 'Las repeticiones deben ser un número entero entre 0 y 300');
    rows.push({ session_id: sid, exercise_id: exerciseId, planned_exercise_id: planned, set_number: rows.length + 1, weight_kg: w, reps: r, duration_s: null });
  }
  if (!rows.length) throw new HttpError(400, 'Cargá al menos una serie');
  await q(db.from('workout_sets').delete().eq('session_id', sid).eq('planned_exercise_id', planned));
  await q(db.from('workout_sets').insert(rows));
  // Con cada guardado se revisa si el objetivo de la rutina debe actualizarse.
  let target_update = null;
  if (exerciseId === planned && DAY_CODES.includes(ses[0].title)) {
    try { target_update = await autoUpdateTarget(ses[0].title, planned); } catch (err) { console.error('autoUpdateTarget', err); }
  }
  return { ok: true, sets: rows.length, target_update };
}

async function setWorkoutStatus(sid: string, status: 'completed' | 'open') {
  if (!UUID_RE.test(sid)) throw new HttpError(400, 'Sesión inválida');
  const rows = await q<any[]>(db.from('workout_sessions').update({ status }).eq('id', sid).select('id,status'));
  if (!rows.length) throw new HttpError(404, 'La sesión no existe');
  return rows[0];
}

async function deleteWorkout(sid: string) {
  if (!UUID_RE.test(sid)) throw new HttpError(400, 'Sesión inválida');
  await q(db.from('workout_sessions').delete().eq('id', sid));
  return { ok: true };
}

async function saveWeight(body: any) {
  const date = String(body?.date ?? todayBA());
  if (!DATE_RE.test(date) || date > todayBA()) throw new HttpError(400, 'Fecha inválida');
  const w = num(String(body?.weight_kg ?? '').replace(',', '.'));
  if (w === null || w <= 20 || w >= 400) throw new HttpError(400, 'Ingresá un peso entre 20 y 400 kg');
  const notes = String(body?.notes ?? '').trim().slice(0, 300) || null;
  const now = new Date().toISOString();
  const rows = await q<any[]>(db.from('body_weight_records').upsert(
    { measurement_date: date, weight_kg: Math.round(w * 100) / 100, notes, source: 'manual', measured_at: now, updated_at: now },
    { onConflict: 'measurement_date' },
  ).select('id,measurement_date,weight_kg,notes'));
  return { ok: true, record: rows[0] };
}

async function deleteWeight(id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Registro inválido');
  await q(db.from('body_weight_records').delete().eq('id', id));
  return { ok: true };
}

const BODY_GOALS = ['cut_preserve_muscle', 'muscle_gain', 'recomposition', 'maintenance'];
async function saveGoals(body: any) {
  const int = (k: string, min: number, max: number) => {
    const v = body?.[k];
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'Revisá los valores ingresados');
    return n;
  };
  const dec = (k: string, min: number, max: number) => {
    const v = body?.[k];
    if (v === null || v === undefined || v === '') return null;
    const n = num(String(v).replace(',', '.'));
    if (n === null || n < min || n > max) throw new HttpError(400, 'Revisá los valores ingresados');
    return Math.round(n * 100) / 100;
  };
  const bodyGoal = body?.body_goal ? String(body.body_goal) : null;
  if (bodyGoal && !BODY_GOALS.includes(bodyGoal)) throw new HttpError(400, 'Objetivo corporal inválido');
  const row = {
    id: 1, daily_steps_goal: int('daily_steps_goal', 1000, 100000), weekly_intensity_minutes_goal: int('weekly_intensity_minutes_goal', 0, 10080),
    target_weight_kg: dec('target_weight_kg', 20, 400), body_goal: bodyGoal, weekly_strength_sessions_goal: int('weekly_strength_sessions_goal', 0, 14),
    nightly_sleep_hours_goal: dec('nightly_sleep_hours_goal', 1, 16), updated_at: new Date().toISOString(),
  };
  return (await q<any[]>(db.from('dashboard_goals').upsert(row, { onConflict: 'id' }).select('*')))[0];
}

// ------------------------------------------------------------------ router

async function authorize(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Iniciá sesión para continuar');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Tu sesión venció. Volvé a ingresar');
  const email = (data.user.email ?? '').toLowerCase();
  // Email autorizado: secreto ALLOWED_EMAIL o tabla cerrada app_allowed_users.
  // Además el email tiene que estar confirmado (evita cuentas creadas con tu email sin acceso a tu casilla).
  if (!data.user.email_confirmed_at) throw new HttpError(403, 'Confirmá tu email antes de ingresar');
  let allowed = !!email && email === ALLOWED_EMAIL;
  if (!allowed && email) {
    const rows = await q<any[]>(db.from('app_allowed_users').select('email').eq('email', email).limit(1));
    allowed = rows.length > 0;
  }
  if (!allowed) throw new HttpError(403, 'Esta cuenta no tiene acceso al dashboard');
  return data.user;
}

async function route(req: Request, path: string[], url: URL) {
  const m = req.method;
  const body = m === 'POST' || m === 'PUT' ? await req.json().catch(() => ({})) : null;
  const period = url.searchParams.get('period') ?? 'month';
  if (!(period in PERIODS)) throw new HttpError(400, 'Período inválido');
  const [a, b, c] = path;

  if (m === 'GET' && a === 'me') return { ok: true };
  if (m === 'GET' && a === 'overview') return overview();
  if (m === 'GET' && a === 'global') return globalEvolution(period);
  if (m === 'GET' && a === 'strength' && !b) return strength(period);
  if (m === 'GET' && a === 'strength' && b === 'session' && c) return sessionDetail(c, path[3] ?? '');
  if (m === 'GET' && a === 'workout' && b === 'today') {
    const date = url.searchParams.get('date') ?? todayBA();
    if (!DATE_RE.test(date)) throw new HttpError(400, 'Fecha inválida');
    return workoutToday(url.searchParams.get('day') ?? '', date);
  }
  if (m === 'PUT' && a === 'routine' && b === 'order') return saveRoutineOrder(body);
  if (m === 'POST' && a === 'workouts' && !b) return createOrResumeWorkout(body);
  if (m === 'PUT' && a === 'workouts' && b && c === 'exercise') return saveExerciseSets(b, body);
  if (m === 'POST' && a === 'workouts' && b && c === 'finish') return setWorkoutStatus(b, 'completed');
  if (m === 'POST' && a === 'workouts' && b && c === 'reopen') return setWorkoutStatus(b, 'open');
  if (m === 'DELETE' && a === 'workouts' && b) return deleteWorkout(b);
  if (m === 'GET' && a === 'weight') {
    const [weights, goals] = await Promise.all([loadWeights(), loadGoals()]);
    return { records: weights, summary: weightSummary(weights, num(goals.target_weight_kg)), target: num(goals.target_weight_kg) };
  }
  if (m === 'POST' && a === 'weight') return saveWeight(body);
  if (m === 'DELETE' && a === 'weight' && b) return deleteWeight(b);
  if (m === 'GET' && a === 'goals') return loadGoals();
  if (m === 'PUT' && a === 'goals') return saveGoals(body);
  if (m === 'GET' && a === 'health') {
    const { start, end } = periodRange(period);
    const rows = await loadHealth(start, end);
    const all = await q<any[]>(db.from('daily_health').select('date').order('date', { ascending: false }).limit(1));
    return { period, start, end, rows, latest_date: all[0]?.date ?? null, goals: await loadGoals() };
  }
  throw new HttpError(404, 'Recurso no encontrado');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('api');
  const path = (i >= 0 ? parts.slice(i + 1) : parts).map(decodeURIComponent);
  try {
    if (path[0] === 'health-check') {
      // Usado por el keep-alive de GitHub Actions: toca la base (sin devolver datos)
      // para que el proyecto gratuito no se pause por inactividad.
      await q(db.from('dashboard_goals').select('id', { head: true, count: 'exact' }));
      return json({ ok: true }, 200, origin);
    }
    await authorize(req);
    return json(await route(req, path, url), 200, origin);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status, origin);
    console.error(err);
    return json({ error: 'Ocurrió un error inesperado. Probá de nuevo.' }, 500, origin);
  }
});
