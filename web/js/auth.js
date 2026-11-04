// Login con Supabase Auth. Es el único módulo que usa la clave publishable.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

// La sesión se guarda en sessionStorage: se borra al cerrar la app o la pestaña,
// así que cada vez que se abre la app pide email y contraseña.
// (Antes se guardaba en localStorage y quedaba abierta para siempre: se limpia.)
try { localStorage.removeItem('ds-auth'); } catch { /* sin acceso a storage */ }
const sessionStore = (() => {
  try { sessionStorage.setItem('ds-test', '1'); sessionStorage.removeItem('ds-test'); return sessionStorage; }
  catch { // sin storage: la sesión vive solo en memoria
    const mem = new Map();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  }
})();

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, storage: sessionStore, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ds-auth' },
});

/** Minutos en segundo plano tras los cuales se cierra la sesión. */
export const LOCK_AFTER_MIN = 15;

export async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

const redirectTo = () => location.origin + location.pathname;

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translate(error.message));
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error) throw new Error(translate(error.message));
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(translate(error.message));
}

export async function signOut() {
  // 'local': cierra solo este dispositivo (no desconecta la PC si se bloquea el celular).
  await supabase.auth.signOut({ scope: 'local' });
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

function translate(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Todavía no confirmaste tu email. Revisá tu casilla.';
  if (m.includes('already registered')) return 'Ese email ya tiene cuenta. Iniciá sesión.';
  if (m.includes('password should be')) return 'La contraseña debe tener al menos 8 caracteres.';
  if (m.includes('rate limit')) return 'Demasiados intentos. Esperá unos minutos.';
  if (m.includes('signups not allowed')) return 'El registro de cuentas está desactivado.';
  return 'No se pudo completar la operación. Probá de nuevo.';
}
