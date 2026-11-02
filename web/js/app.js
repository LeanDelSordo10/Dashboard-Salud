import { supabase, currentUser, signIn, signUp, resetPassword, updatePassword, signOut, onAuthChange } from './auth.js';
import { api } from './api.js';
import { $, $$, toast, disposeCharts, closeDrawer, errorState } from './ui.js';
import summary from './pages/summary.js';
import evolution from './pages/evolution.js';
import strength from './pages/strength.js';
import sessions from './pages/sessions.js';
import workout from './pages/workout.js';
import weight from './pages/weight.js';
import health from './pages/health.js';
import settings from './pages/settings.js';
import { loadMuscleAssets } from './muscle-map.js';

const ROUTES = {
  resumen: { title: 'Resumen', page: summary },
  evolucion: { title: 'Evolución global', page: evolution },
  registrar: { title: 'Registrar entrenamiento', page: workout },
  fuerza: { title: 'Análisis de fuerza', page: strength },
  sesiones: { title: 'Sesiones de fuerza', page: sessions },
  peso: { title: 'Peso corporal', page: weight },
  salud: { title: 'Pasos, sueño y recuperación', page: health },
  configuracion: { title: 'Configuración', page: settings },
};

let current = null;       // ruta actual
let cleanup = null;       // función de limpieza de la página actual
let lastLoad = 0;

// ------------------------------------------------------------------ router

function parseHash() {
  const [route, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: ROUTES[route] ? route : 'resumen', params: rest.map(decodeURIComponent) };
}

async function render({ keepScroll = false } = {}) {
  const { route, params } = parseHash();
  const def = ROUTES[route];
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* noop */ } }
  cleanup = null;
  disposeCharts();
  closeDrawer();
  document.body.classList.remove('nav-open');
  current = route;
  $('#pageTitle').textContent = def.title;
  $('#pageSub').textContent = '';
  document.title = `${def.title} · Dashboard Salud`;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  const view = $('#view');
  const y = window.scrollY;
  view.innerHTML = '';
  try {
    cleanup = await def.page(view, { params, setSub: (t) => ($('#pageSub').textContent = t) });
    lastLoad = Date.now();
    updateStamp();
  } catch (err) {
    handleError(err, view);
  }
  if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

export function handleError(err, view) {
  if (err?.status === 401) { showAuth('login', 'Tu sesión venció. Volvé a ingresar.'); return; }
  if (err?.status === 403) { showAuth('login', err.message); signOut(); return; }
  if (view) {
    view.innerHTML = errorState(err?.message || 'Error inesperado');
    const b = view.querySelector('[data-retry]');
    if (b) b.onclick = () => render();
  } else toast(err?.message || 'Error inesperado', 'error');
}

function updateStamp() {
  const s = Math.round((Date.now() - lastLoad) / 60000);
  $('#updatedAt').textContent = lastLoad ? (s < 1 ? 'Actualizado ahora' : `Actualizado hace ${s} min`) : '';
}
setInterval(updateStamp, 30000);

// Los datos se vuelven a leer al volver a la app (si pasó más de 1 minuto),
// salvo en la pantalla de registro para no pisar lo que se está cargando.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#app').hidden && current !== 'registrar' && Date.now() - lastLoad > 60000) render({ keepScroll: true });
});

window.addEventListener('hashchange', () => { if (!$('#app').hidden) render(); });
$('#refreshBtn').onclick = () => render({ keepScroll: true });
$('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
$('#moreBtn').onclick = () => document.body.classList.toggle('nav-open');
$('#sidebarBackdrop').onclick = () => document.body.classList.remove('nav-open');
$('#drawerBackdrop').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); document.body.classList.remove('nav-open'); } });

// -------------------------------------------------------------------- auth

let authMode = 'login';
function showAuth(mode = 'login', message = '') {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  setAuthMode(mode);
  if (message) setAuthMsg(message, 'error');
}
function setAuthMsg(text, type = '') { const m = $('#authMsg'); m.textContent = text; m.className = `form-msg ${type}`; }
function setAuthMode(mode) {
  authMode = mode;
  const cfg = {
    login: ['Ingresar', 'Acceso privado.', 'Ingresar', true, 'current-password'],
    signup: ['Crear cuenta', 'Solo el email autorizado puede ver los datos.', 'Crear cuenta', true, 'new-password'],
    reset: ['Recuperar contraseña', 'Te enviamos un enlace para crear una nueva.', 'Enviar enlace', false, ''],
    newpass: ['Nueva contraseña', 'Elegí una contraseña de al menos 8 caracteres.', 'Guardar contraseña', true, 'new-password'],
  }[mode];
  $('#authTitle').textContent = cfg[0];
  $('#authSub').textContent = cfg[1];
  $('#authSubmit').textContent = cfg[2];
  $('#authPassWrap').hidden = !cfg[3];
  $('#authPass').autocomplete = cfg[4] || 'off';
  $('#authEmail').closest('.field').hidden = mode === 'newpass';
  $$('[data-auth-mode]').forEach((b) => (b.hidden = b.dataset.authMode === mode || (mode !== 'login' && b.dataset.authMode !== 'login')));
  setAuthMsg('');
}
$$('[data-auth-mode]').forEach((b) => (b.onclick = () => setAuthMode(b.dataset.authMode)));

$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value;
  const btn = $('#authSubmit');
  if (authMode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)) return setAuthMsg('Ingresá un email válido.', 'error');
  if (authMode !== 'reset' && pass.length < 8) return setAuthMsg('La contraseña debe tener al menos 8 caracteres.', 'error');
  btn.disabled = true;
  try {
    if (authMode === 'login') { await signIn(email, pass); await enterApp(); }
    if (authMode === 'signup') {
      const r = await signUp(email, pass);
      if (r?.session) await enterApp();
      else { setAuthMode('login'); setAuthMsg('Listo. Te enviamos un email para confirmar la cuenta. Después volvé y ingresá.', 'ok'); }
    }
    if (authMode === 'reset') { await resetPassword(email); setAuthMsg('Si el email existe, te llegó un enlace para cambiar la contraseña.', 'ok'); }
    if (authMode === 'newpass') { await updatePassword(pass); toast('Contraseña actualizada'); await enterApp(); }
  } catch (err) {
    setAuthMsg(err.message, 'error');
  } finally { btn.disabled = false; }
};

async function enterApp() {
  try {
    await api.me(); // valida en el servidor que la cuenta esté autorizada
  } catch (err) {
    if (err.status === 403) { await signOut(); showAuth('login', err.message); return; }
    if (err.status === 401) { showAuth('login'); return; }
    // Otros errores (sin conexión): igual se entra y cada página muestra su error.
  }
  await loadMuscleAssets();
  const user = await currentUser();
  $('#userEmail').textContent = user?.email ?? '';
  $('#auth').hidden = true;
  $('#app').hidden = false;
  if (!location.hash) history.replaceState(null, '', '#/resumen');
  render();
}

onAuthChange((event) => {
  if (event === 'PASSWORD_RECOVERY') showAuth('newpass');
  if (event === 'SIGNED_OUT') showAuth('login');
});

export async function logout() { await signOut(); showAuth('login'); }

(async function boot() {
  // Enlaces de confirmación / recuperación vuelven con tokens en la URL.
  const hash = location.hash;
  if (/type=recovery/.test(hash)) { showAuth('newpass'); return; }
  if (/error_description=/.test(hash)) {
    const msg = decodeURIComponent(hash.match(/error_description=([^&]+)/)[1]).replace(/\+/g, ' ');
    history.replaceState(null, '', location.pathname);
    showAuth('login', /expired/i.test(msg) ? 'El enlace venció. Pedí uno nuevo.' : 'No se pudo validar el enlace.');
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (/access_token=/.test(hash)) history.replaceState(null, '', location.pathname + '#/resumen');
  if (data.session) enterApp(); else showAuth('login');
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
