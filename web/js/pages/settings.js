import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { logout } from '../app.js';
import { esc, toast, $ } from '../ui.js';
import { APP_VERSION } from '../config.js';

const BODY_GOALS = { cut_preserve_muscle: 'Déficit + mantener músculo', muscle_gain: 'Ganancia muscular', recomposition: 'Recomposición', maintenance: 'Mantenimiento' };

export default async function settings(view) {
  const [g, user] = await Promise.all([api.goals(), currentUser()]);
  const v = (k) => (g[k] === null || g[k] === undefined ? '' : String(g[k]).replace('.', ','));
  view.innerHTML = `
    <div class="cols-2">
      <div class="card">
        <div class="card-head"><div><h2>Objetivos</h2><p>Se usan en el resumen, los gráficos y las comparaciones.</p></div></div>
        <form id="gForm" class="stack" novalidate>
          <div class="form-grid">
            <label class="field"><span>Peso objetivo (kg)</span><input name="target_weight_kg" inputmode="decimal" value="${v('target_weight_kg')}"></label>
            <label class="field"><span>Objetivo corporal</span><select name="body_goal"><option value="">—</option>${Object.entries(BODY_GOALS).map(([k, l]) => `<option value="${k}" ${g.body_goal === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Entrenamientos de fuerza por semana</span><input name="weekly_strength_sessions_goal" inputmode="numeric" value="${v('weekly_strength_sessions_goal')}"></label>
            <label class="field"><span>Pasos diarios</span><input name="daily_steps_goal" inputmode="numeric" value="${v('daily_steps_goal')}"></label>
            <label class="field"><span>Horas de sueño por noche</span><input name="nightly_sleep_hours_goal" inputmode="decimal" value="${v('nightly_sleep_hours_goal')}"></label>
            <label class="field"><span>Minutos de intensidad por semana</span><input name="weekly_intensity_minutes_goal" inputmode="numeric" value="${v('weekly_intensity_minutes_goal')}"></label>
          </div>
          <div class="row"><button class="btn primary" id="gSave">Guardar objetivos</button><span class="form-msg" id="gMsg"></span></div>
        </form>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Cuenta</h2><p>Sesión iniciada como</p></div></div>
          <p><b>${esc(user?.email ?? '')}</b></p>
          <div class="row section"><button class="btn danger" id="logout">Cerrar sesión</button></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Tus datos</h2></div></div>
          <ul class="muted small" style="padding-left:18px;margin:0;display:grid;gap:6px">
            <li>Todo se guarda en tu base de datos privada en la nube, al instante.</li>
            <li>Solo tu cuenta puede leer o modificar los datos; la validación ocurre en el servidor.</li>
            <li>La app no guarda datos en el teléfono más allá de tu sesión iniciada.</li>
          </ul>
          <p class="muted small section">Versión ${APP_VERSION}</p>
        </div>
      </div>
    </div>`;
  $('#logout').onclick = logout;
  $('#gForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(fd)) if (k !== 'body_goal') fd[k] = fd[k].trim().replace(',', '.');
    const btn = $('#gSave'), msg = $('#gMsg');
    btn.disabled = true;
    try { await api.saveGoals(fd); msg.className = 'form-msg ok'; msg.textContent = '✓ Guardado'; toast('Objetivos guardados'); }
    catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
    finally { btn.disabled = false; }
  };
}
