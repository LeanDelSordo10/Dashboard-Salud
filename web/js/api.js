// Cliente de la API. Todas las lecturas y escrituras pasan por la Edge Function,
// con el token de la sesión. El frontend nunca consulta tablas directamente.
import { API_URL } from './config.js';
import { getToken } from './auth.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, path, body) {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'Iniciá sesión para continuar');
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Sin conexión. Revisá tu internet y probá de nuevo.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Ocurrió un error. Probá de nuevo.');
  return data;
}

export const api = {
  me: () => request('GET', '/me'),
  overview: () => request('GET', '/overview'),
  global: (period) => request('GET', `/global?period=${period}`),
  strength: (period) => request('GET', `/strength?period=${period}`),
  session: (kind, id) => request('GET', `/strength/session/${kind}/${id}`),
  workoutToday: (day, date) => request('GET', `/workout/today?day=${encodeURIComponent(day)}&date=${date}`),
  createExercise: (payload) => request('POST', '/exercises', payload),
  saveRoutineOrder:(day, exerciseIds) => request('PUT', '/routine/order', { day, exercise_ids: exerciseIds }),
  startWorkout:(title, date) => request('POST', '/workouts', { title, date }),
  saveExercise: (sid, payload) => request('PUT', `/workouts/${sid}/exercise`, payload),
  finishWorkout: (sid) => request('POST', `/workouts/${sid}/finish`),
  reopenWorkout: (sid) => request('POST', `/workouts/${sid}/reopen`),
  deleteWorkout: (sid) => request('DELETE', `/workouts/${sid}`),
  weight: () => request('GET', '/weight'),
  saveWeight: (payload) => request('POST', '/weight', payload),
  deleteWeight: (id) => request('DELETE', `/weight/${id}`),
  goals: () => request('GET', '/goals'),
  saveGoals: (payload) => request('PUT', '/goals', payload),
  health: (period) => request('GET', `/health?period=${period}`),
};
