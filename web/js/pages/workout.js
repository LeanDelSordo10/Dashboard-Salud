// Registro de entrenamiento. Cada ejercicio se guarda en la nube al tocar "Guardar".
import { api } from '../api.js';
import { esc, fmt, fmtDate, fmtDateLong, todayBA, toast, confirmDialog, skeleton, emptyState, $, $$ } from '../ui.js';

const DAYS = [
  { code: 'Upper A', label: 'Tren superior' }, { code: 'Lower A', label: 'Tren inferior' },
  { code: 'Upper B', label: 'Tren superior' }, { code: 'Lower B', label: 'Tren inferior' },
];

export default async function workout(view, { params, setSub }) {
  let day = params[0] && DAYS.some((d) => d.code === params[0]) ? params[0] : 'auto';
  let date = /^\d{4}-\d{2}-\d{2}$/.test(params[1] ?? '') ? params[1] : todayBA();
  let data = null;
  let sessionId = null;
  let sessionStatus = null;

  const dirtyCount = () => $$('.ex-card.dirty', view).length;
  const beforeUnload = (e) => { if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  async function load() {
    view.innerHTML = `<div class="card skeleton" style="min-height:120px"></div><div class="ex-list">${skeleton(3, 'chart-sk')}</div>`;
    data = await api.workoutToday(day, date);
    day = data.day;
    sessionId = data.session?.id ?? null;
    sessionStatus = data.session?.status ?? null;
    render();
  }

  function render() {
    const isToday = date === todayBA();
    setSub(isToday ? 'Hoy' : fmtDateLong(date));
    view.innerHTML = `
      <div class="card">
        <div class="row between" style="margin-bottom:12px">
          <div><span class="eyebrow">Rutina 4 días</span><h2 style="font-size:18px;margin-top:2px">${esc(day)} · ${isToday ? 'hoy' : fmtDateLong(date)}</h2></div>
          <label class="field" style="width:170px"><span>Fecha del entrenamiento</span><input type="date" id="wDate" value="${date}" max="${todayBA()}"></label>
        </div>
        <div class="day-tabs">${DAYS.map((d) => `<button data-day="${d.code}" class="${d.code === day ? 'on' : ''}">${d.code}<small>${d.label}</small></button>`).join('')}</div>
        ${sessionStatus === 'completed' ? `<div class="banner info" style="margin:14px 0 0"><span>✓</span><div>Este entrenamiento ya está finalizado. Podés corregir cualquier ejercicio y volver a guardarlo.</div></div>` : ''}
      </div>
      <div class="ex-list" id="exList">${data.items.length ? data.items.map(cardHTML).join('') : `<div class="card">${emptyState('📋', 'No hay ejercicios cargados para esta rutina')}</div>`}</div>
      ${data.items.length ? `<div class="finish-bar">
        <div class="grow"><div class="row between"><b id="progText"></b><span class="muted small" id="progSub"></span></div><div class="progress green"><span id="progBar" style="width:0"></span></div></div>
        ${sessionStatus === 'completed' ? '<button class="btn" id="reopenBtn">Reabrir</button>' : '<button class="btn primary" id="finishBtn">Finalizar</button>'}
      </div>` : ''}`;
    bind();
    progress();
  }

  function setRow(i, s = {}, timed = false, last = null) {
    const lw = last?.weight_kg ?? '', lr = last?.reps ?? '', ld = last?.duration_s ?? '';
    return timed
      ? `<div class="set-row timed"><div class="n">${i}</div>
          <div class="unit" data-unit="seg"><input inputmode="numeric" class="in-dur" value="${s.duration_s ?? ''}" placeholder="${ld || 'seg'}" aria-label="Segundos serie ${i}"></div>
          <button class="rm" title="Quitar serie" aria-label="Quitar serie">✕</button></div>`
      : `<div class="set-row"><div class="n">${i}</div>
          <div class="unit" data-unit="kg"><input inputmode="decimal" class="in-w" value="${s.weight_kg ?? ''}" placeholder="${lw === '' ? 'kg' : fmt(lw)}" aria-label="Kilos serie ${i}"></div>
          <div class="unit" data-unit="reps"><input inputmode="numeric" class="in-r" value="${s.reps ?? ''}" placeholder="${lr === '' ? 'reps' : lr}" aria-label="Repeticiones serie ${i}"></div>
          <button class="rm" title="Quitar serie" aria-label="Quitar serie">✕</button></div>`;
  }

  function cardHTML(it, idx) {
    const timed = it.measurement_type === 'duration';
    const t = it.target;
    const reps = t.reps_min ? (t.reps_max && t.reps_max !== t.reps_min ? `${t.reps_min}–${t.reps_max}` : t.reps_min) : null;
    const target = [t.sets ? `${t.sets} series` : null, reps ? `${reps} reps` : null, t.weight_kg ? `${fmt(t.weight_kg)} kg` : null].filter(Boolean).join(' · ');
    const lastTxt = it.last ? `<b>Último (${fmtDate(it.last.date)}):</b> ${it.last.sets.map((s) => (timed ? `${fmt(s.duration_s, 0)} s` : `${fmt(s.weight_kg)}×${s.reps ?? '—'}`)).join(' · ')}` : 'Sin registros anteriores de este ejercicio.';
    // Si ya se guardó, se muestran las series guardadas; si no, el peso del último registro como sugerencia.
    const rows = it.saved?.sets?.length
      ? it.saved.sets.map((s, i) => setRow(i + 1, s, timed, it.last?.sets[i]))
      : Array.from({ length: Math.max(1, t.sets || it.last?.sets.length || 3) }, (_, i) => {
          const ls = it.last?.sets[i] ?? it.last?.sets.at(-1);
          return setRow(i + 1, timed ? {} : { weight_kg: ls?.weight_kg ?? t.weight_kg ?? '' }, timed, ls);
        });
    const chosen = it.saved?.exercise_id ?? it.exercise_id;
    return `<article class="card ex-card ${it.saved ? 'saved' : ''}" data-idx="${idx}" data-timed="${timed ? 1 : 0}">
      <div class="ex-head"><div class="ex-num">${it.saved ? '✓' : it.position}</div>
        <div class="ex-title"><b class="ex-name">${esc(data.catalog.find((c) => c.id === chosen)?.name ?? it.name)}</b>
          <div class="ex-meta">${it.muscle ? `<span>${esc(it.muscle)}</span>` : ''}${target ? `<span>Objetivo: ${target}</span>` : ''}</div></div></div>
      <div class="ex-last">${lastTxt}</div>
      <div class="set-head ${timed ? 'timed' : ''}"><span>#</span>${timed ? '<span>Duración</span>' : '<span>Kilos</span><span>Reps</span>'}<span></span></div>
      <div class="set-grid">${rows.join('')}</div>
      <div class="ex-actions">
        <button class="btn sm ghost add">＋ Serie</button>
        ${it.last ? '<button class="btn sm ghost copy">Repetir último</button>' : ''}
        <span class="status ${it.saved ? 'ok' : ''}">${it.saved ? `✓ Guardado (${it.saved.sets.length} series)` : ''}</span>
        <button class="btn sm primary save">${it.saved ? 'Actualizar' : 'Guardar'}</button>
      </div>
      <details class="swap"><summary>⇄ Cambiar ejercicio (si usaste otra máquina)</summary>
        <select class="pick">${data.catalog.map((c) => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${esc(c.name)}${c.muscle ? ' · ' + esc(c.muscle) : ''}</option>`).join('')}</select></details>
    </article>`;
  }

  function renumber(card) { $$('.set-row', card).forEach((r, i) => ($('.n', r).textContent = i + 1)); }
  function markDirty(card) {
    card.classList.add('dirty');
    const st = $('.status', card); st.className = 'status warn'; st.textContent = 'Cambios sin guardar';
  }

  function bind() {
    $('#wDate').onchange = async (e) => {
      const v = e.target.value;
      if (!v || v > todayBA()) { e.target.value = date; return; }
      if (dirtyCount() && !(await confirmDialog('Cambios sin guardar', 'Hay ejercicios sin guardar. Si cambiás la fecha se van a perder.', { ok: 'Cambiar igual' }))) { e.target.value = date; return; }
      date = v; day = 'auto'; history.replaceState(null, '', '#/registrar'); load();
    };
    $$('[data-day]', view).forEach((b) => (b.onclick = async () => {
      if (b.dataset.day === day) return;
      if (dirtyCount() && !(await confirmDialog('Cambios sin guardar', 'Hay ejercicios sin guardar. Si cambiás de rutina se van a perder.', { ok: 'Cambiar igual' }))) return;
      day = b.dataset.day; load();
    }));
    $$('.ex-card', view).forEach((card) => {
      const it = data.items[Number(card.dataset.idx)];
      const timed = card.dataset.timed === '1';
      card.addEventListener('input', () => markDirty(card));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.rm')) {
          const rows = $$('.set-row', card);
          if (rows.length > 1) { e.target.closest('.set-row').remove(); renumber(card); markDirty(card); }
        }
      });
      $('.add', card).onclick = () => {
        const rows = $$('.set-row', card);
        const lastRow = rows.at(-1);
        const w = lastRow ? $('.in-w', lastRow)?.value : '';
        $('.set-grid', card).insertAdjacentHTML('beforeend', setRow(rows.length + 1, timed ? {} : { weight_kg: w }, timed, it.last?.sets.at(-1)));
        markDirty(card);
        $$('.set-row', card).at(-1).querySelector('input').focus();
      };
      const copy = $('.copy', card);
      if (copy) copy.onclick = () => {
        $('.set-grid', card).innerHTML = it.last.sets.map((s, i) => setRow(i + 1, s, timed, s)).join('');
        markDirty(card);
      };
      $('.pick', card).onchange = (e) => {
        const c = data.catalog.find((x) => x.id === e.target.value);
        $('.ex-name', card).textContent = c?.name ?? it.name;
        if ((c?.measurement_type === 'duration') !== timed) toast('Ese ejercicio se mide distinto: revisá las series', 'error');
        markDirty(card);
      };
      $('.save', card).onclick = () => save(card, it, timed);
    });
    const fin = $('#finishBtn');
    if (fin) fin.onclick = finish;
    const re = $('#reopenBtn');
    if (re) re.onclick = async () => { try { await api.reopenWorkout(sessionId); sessionStatus = 'open'; toast('Sesión reabierta'); render(); } catch (err) { toast(err.message, 'error'); } };
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const s = await api.startWorkout(day, date);
    sessionId = s.id; sessionStatus = s.status;
    return sessionId;
  }

  async function save(card, it, timed) {
    const st = $('.status', card), btn = $('.save', card);
    const sets = [];
    let incomplete = 0;
    for (const row of $$('.set-row', card)) {
      if (timed) {
        const v = $('.in-dur', row).value.trim();
        if (!v) continue;
        const d = Number(v.replace(',', '.'));
        if (!Number.isFinite(d) || d <= 0) { st.className = 'status err'; st.textContent = 'Revisá los segundos'; return; }
        sets.push({ duration_s: d });
      } else {
        const w = $('.in-w', row).value.trim().replace(',', '.'), r = $('.in-r', row).value.trim();
        if (!r) { if (w) incomplete++; continue; } // sin repeticiones la serie no se hizo
        const wn = w === '' ? null : Number(w), rn = Number(r);
        if ((wn !== null && (!Number.isFinite(wn) || wn < 0 || wn > 500)) || !Number.isInteger(rn) || rn < 0 || rn > 300) {
          st.className = 'status err'; st.textContent = 'Revisá kilos y repeticiones'; return;
        }
        sets.push({ weight_kg: wn, reps: rn });
      }
    }
    if (!sets.length) { st.className = 'status err'; st.textContent = timed ? 'Cargá la duración' : 'Cargá las repeticiones de al menos una serie'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const sid = await ensureSession();
      const exerciseId = $('.pick', card).value;
      const r = await api.saveExercise(sid, { exercise_id: exerciseId, planned_exercise_id: it.exercise_id, sets });
      it.saved = { exercise_id: exerciseId, sets };
      card.classList.remove('dirty'); card.classList.add('saved');
      $('.ex-num', card).textContent = '✓';
      st.className = 'status ok';
      st.textContent = `✓ Guardado (${r.sets} series)${incomplete ? ` · ${incomplete} sin reps no se guardaron` : ''}`;
      btn.textContent = 'Actualizar';
      if (navigator.vibrate) navigator.vibrate(30);
      progress();
    } catch (err) {
      st.className = 'status err'; st.textContent = err.status === 0 ? 'Sin conexión: no se guardó. Probá de nuevo.' : err.message;
      btn.textContent = 'Reintentar';
      toast('No se pudo guardar el ejercicio', 'error');
    } finally { btn.disabled = false; }
  }

  function progress() {
    const total = data.items.length; if (!total) return;
    const done = data.items.filter((x) => x.saved).length;
    $('#progText').textContent = `${done} de ${total} ejercicios guardados`;
    $('#progSub').textContent = sessionStatus === 'completed' ? 'Finalizado ✓' : done ? 'Guardado en la nube' : '';
    $('#progBar').style.width = `${Math.round((done * 100) / total)}%`;
    const fin = $('#finishBtn'); if (fin) fin.disabled = done === 0;
  }

  async function finish() {
    const pending = data.items.filter((x) => !x.saved).length;
    if (dirtyCount()) { toast('Guardá los ejercicios con cambios antes de finalizar', 'error'); return; }
    if (pending && !(await confirmDialog('Finalizar entrenamiento', `Quedan ${pending} ejercicios sin cargar. ¿Finalizar igual?`, { ok: 'Finalizar' }))) return;
    try {
      await api.finishWorkout(sessionId);
      sessionStatus = 'completed';
      toast('¡Entrenamiento finalizado! 💪');
      location.hash = '#/resumen';
    } catch (err) { toast(err.message, 'error'); }
  }

  await load();
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
