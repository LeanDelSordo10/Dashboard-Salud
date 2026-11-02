import { api } from '../api.js';
import { esc, fmt, fmtInt, fmtDate, fmtDateLong, fmtDuration, fmtVolume, skeleton, emptyState, periodPicker, openDrawer, closeDrawer, confirmDialog, toast, $, $$ } from '../ui.js';
import { muscleMap } from '../muscle-map.js';

const setLabel = (s) => (s.weight_kg === null && s.reps === null && s.duration_s ? `${fmt(s.duration_s, 0)} s`
  : `${s.weight_kg !== null ? fmt(s.weight_kg, 1) + ' kg' : '—'} × ${s.reps ?? '—'}`);

/** Abre el detalle de una sesión en el panel lateral. */
export async function openSession(kind, id, onChange) {
  const box = openDrawer(`<div class="card skeleton chart-sk"></div>`);
  try {
    const s = await api.session(kind, id);
    const m = s.metrics;
    box.innerHTML = `
      <div><span class="tag ${s.kind}">${s.kind === 'garmin' ? 'Importada de Garmin' : 'Registro manual'}</span>
        ${s.status === 'open' ? '<span class="chip warn" style="margin-left:6px">Sin finalizar</span>' : ''}</div>
      <h2>${esc(s.title)}</h2>
      <p class="muted" style="margin-top:-8px">${fmtDateLong(s.date)}</p>
      <div class="mini-kpis">
        <div><span class="eyebrow">Series</span><b>${m.sets}</b></div>
        <div><span class="eyebrow">Reps</span><b>${fmtInt(m.reps)}</b></div>
        <div><span class="eyebrow">Volumen</span><b>${fmtVolume(m.volume)}</b></div>
        ${m.duration_s ? `<div><span class="eyebrow">Duración</span><b>${fmtDuration(m.duration_s)}</b></div>` : ''}
        ${m.calories ? `<div><span class="eyebrow">Calorías</span><b>${fmtInt(m.calories)}</b></div>` : ''}
        ${m.hr_avg ? `<div><span class="eyebrow">FC media / máx</span><b>${m.hr_avg} / ${m.hr_max ?? '—'}</b></div>` : ''}
      </div>
      <div class="card">${muscleMap(s.muscles)}</div>
      <div class="card"><div class="card-head"><h3>Ejercicios</h3></div>
        <div class="list">${s.exercises.map((e) => `
          <div class="list-item" style="cursor:default;display:block">
            <div class="row between"><b>${esc(e.name)}</b><span class="muted small">${esc(e.muscle)} · ${fmtVolume(e.volume)}</span></div>
            <div class="set-chips">${e.sets.map((x) => `<span>${setLabel(x)}</span>`).join('')}</div>
          </div>`).join('') || '<p class="muted">Sin series registradas.</p>'}</div>
      </div>
      ${s.kind === 'manual' ? `<div class="row">
        ${s.status === 'open' ? '<button class="btn success" data-act="finish">✓ Marcar como finalizada</button>' : ''}
        <a class="btn" href="#/registrar/${encodeURIComponent(s.title)}/${s.date}">Editar series</a>
        <button class="btn danger" data-act="delete">Eliminar sesión</button></div>` : ''}`;
    $$('[data-act]', box).forEach((b) => (b.onclick = async () => {
      try {
        if (b.dataset.act === 'finish') { await api.finishWorkout(id); toast('Sesión finalizada'); }
        if (b.dataset.act === 'delete') {
          if (!(await confirmDialog('Eliminar sesión', `Se borrará "${s.title}" del ${fmtDate(s.date)} con todas sus series. No se puede deshacer.`, { ok: 'Eliminar', danger: true }))) return;
          await api.deleteWorkout(id); toast('Sesión eliminada');
        }
        closeDrawer(); onChange?.();
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

export default async function sessions(view, { setSub }) {
  let period = 'quarter';
  const load = async () => {
    view.innerHTML = `<div class="toolbar">${periodPicker(period)}</div><div class="card skeleton chart-sk"></div>`;
    const d = await api.strength(period);
    setSub(`${d.sessions.length} sesiones`);
    const groups = new Map();
    for (const s of d.sessions) {
      const key = new Date(s.date + 'T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
      (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
    }
    view.innerHTML = `<div class="toolbar">${periodPicker(period)}<a class="btn primary" href="#/registrar">＋ Registrar entrenamiento</a></div>
      ${d.sessions.length ? [...groups].map(([month, list]) => `
        <div class="card section"><div class="card-head"><h3 style="text-transform:capitalize">${esc(month)}</h3><span class="muted small">${list.length} sesiones</span></div>
        <div class="list">${list.map((s) => `
          <button class="list-item" data-kind="${s.kind}" data-id="${s.id}">
            <div class="date-badge"><b>${new Date(s.date + 'T12:00:00').getDate()}</b><small>${fmtDate(s.date, { weekday: 'short' })}</small></div>
            <div class="grow"><div class="title">${esc(s.title)}</div><div class="muted small">${s.exercises} ejercicios · ${s.sets} series · ${fmtVolume(s.volume)}</div></div>
            <span class="tag ${s.kind}">${s.kind === 'garmin' ? 'Garmin' : 'Manual'}</span>
          </button>`).join('')}</div></div>`).join('')
        : `<div class="card">${emptyState('🏋', 'No hay sesiones en este período', 'Probá con un período más largo o registrá un entrenamiento.', '<a class="btn primary" href="#/registrar">Registrar entrenamiento</a>')}</div>`}`;
    $$('[data-period]', view).forEach((b) => (b.onclick = () => { period = b.dataset.period; load(); }));
    $$('[data-kind]', view).forEach((b) => (b.onclick = () => openSession(b.dataset.kind, b.dataset.id, load)));
  };
  await load();
}
