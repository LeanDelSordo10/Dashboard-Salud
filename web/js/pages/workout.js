// Registro de entrenamiento. Cada ejercicio se guarda en la nube al tocar "Guardar".
import { api } from '../api.js';
import { esc, fmt, fmtDate, fmtDateLong, todayBA, toast, confirmDialog, skeleton, emptyState, $, $$ } from '../ui.js';

const DAYS = [
  { code: 'Upper A', label: 'Tren superior' }, { code: 'Lower A', label: 'Tren inferior' },
  { code: 'Upper B', label: 'Tren superior' }, { code: 'Lower B', label: 'Tren inferior' },
];
// Grupos musculares (los mismos ids de assets/muscle-map.json).
const MUSCLES = ['Pecho', 'Espalda', 'Hombros', 'Bíceps', 'Tríceps', 'Abdominales', 'Glúteos', 'Cuádriceps', 'Isquiotibiales', 'Aductores', 'Gemelos'];

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
    data.extras ??= [];
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
      <h3 class="extras-head" id="extrasHead" ${data.extras.length ? '' : 'hidden'}>Ejercicios adicionales</h3>
      <div class="ex-list extra-list" id="extraList">${data.extras.map(cardHTML).join('')}</div>
      <details class="card add-extra" id="addExtra">
        <summary><span class="add-extra-btn">＋ Agregar ejercicio adicional</span><small>Solo para este entrenamiento, salvo que marques “Agregar a mi rutina”</small></summary>
        <div class="picker">${pickerHTML()}</div>
      </details>
      ${data.items.length ? `<div class="finish-bar">
        <div class="grow"><div class="row between"><b id="progText"></b><span class="muted small" id="progSub"></span></div><div class="progress green"><span id="progBar" style="width:0"></span></div></div>
        ${sessionStatus === 'completed' ? '<button class="btn" id="reopenBtn">Reabrir</button>' : '<button class="btn primary" id="finishBtn">Finalizar</button>'}
      </div>` : ''}
      <datalist id="equipmentList">${[...new Set(data.catalog.map((c) => c.equipment).filter(Boolean))].sort().map((e) => `<option value="${esc(e)}">`).join('')}</datalist>`;
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

  function targetText(t) {
    const reps = t.reps_min ? (t.reps_max && t.reps_max !== t.reps_min ? `${t.reps_min}–${t.reps_max}` : t.reps_min) : null;
    return [t.sets ? `${t.sets} series` : null, reps ? `${reps} reps` : null, t.weight_kg ? `${fmt(t.weight_kg)} kg` : null].filter(Boolean).join(' · ');
  }
  /** Etiqueta que avisa que el objetivo se actualizó solo (lo repetido en 3 sesiones). */
  function changeBadge(c) {
    if (!c) return '';
    const b = c.before, a = c.after;
    const up = (a.weight_kg ?? 0) > (b.weight_kg ?? 0) || (a.reps_min ?? 0) > (b.reps_min ?? 0) || (a.sets ?? 0) > (b.sets ?? 0);
    const when = c.changed_at ? new Date(c.changed_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short' }).replace('.', '') : 'ahora';
    return `<div class="target-change ${up ? 'up' : ''}" title="Antes: ${esc(targetText(b))}">🎯 Objetivo actualizado ${when} · antes ${esc(targetText(b))}</div>`;
  }

  function cardHTML(it, idx) {
    const timed = it.measurement_type === 'duration';
    const t = it.target;
    const target = targetText(t);
    const lastTxt = it.last ? `<b>Último (${fmtDate(it.last.date)}):</b> ${it.last.sets.map((s) => (timed ? `${fmt(s.duration_s, 0)} s` : `${fmt(s.weight_kg)}×${s.reps ?? '—'}`)).join(' · ')}` : 'Sin registros anteriores de este ejercicio.';
    // Si ya se guardó, se muestran las series guardadas; si no, el peso del último registro como sugerencia.
    const rows = it.saved?.sets?.length
      ? it.saved.sets.map((s, i) => setRow(i + 1, s, timed, it.last?.sets[i]))
      : Array.from({ length: Math.max(1, t.sets || it.last?.sets.length || 3) }, (_, i) => {
          const ls = it.last?.sets[i] ?? it.last?.sets.at(-1);
          return setRow(i + 1, timed ? {} : { weight_kg: ls?.weight_kg ?? t.weight_kg ?? '' }, timed, ls);
        });
    const chosen = it.saved?.exercise_id ?? it.exercise_id;
    const extra = !!it.extra;
    return `<article class="card ex-card ${it.saved ? 'saved' : ''} ${extra ? 'extra' : ''}" data-ex="${it.exercise_id}" data-timed="${timed ? 1 : 0}">
      <div class="ex-head">
        ${extra ? '' : `<button type="button" class="drag-handle" aria-label="Mover ${esc(it.name)}. Usá las flechas para subir o bajar" title="Arrastrá para cambiar el orden">⠿</button>`}
        <div class="ex-num">${it.saved ? '✓' : extra ? '＋' : idx + 1}</div>
        <div class="ex-title"><b class="ex-name">${esc(data.catalog.find((c) => c.id === chosen)?.name ?? it.name)}</b>
          <div class="ex-meta">${extra ? '<span class="extra-tag">Adicional</span>' : ''}${it.muscle ? `<span>${esc(it.muscle)}</span>` : ''}${target ? `<span class="ex-target">Objetivo: ${target}</span>` : ''}</div>
          ${changeBadge(it.target_change)}</div></div>
      <div class="ex-last">${lastTxt}</div>
      <div class="set-head ${timed ? 'timed' : ''}"><span>#</span>${timed ? '<span>Duración</span>' : '<span>Kilos</span><span>Reps</span>'}<span></span></div>
      <div class="set-grid">${rows.join('')}</div>
      <div class="ex-actions">
        <button class="btn sm ghost add">＋ Serie</button>
        ${it.last ? '<button class="btn sm ghost copy">Repetir último</button>' : ''}
        <span class="status ${it.saved ? 'ok' : ''}">${it.saved ? `✓ Guardado (${it.saved.sets.length} series)` : ''}</span>
        <button class="btn sm primary save">${it.saved ? 'Actualizar' : 'Guardar'}</button>
      </div>
      ${extra ? `<div class="extra-opts">
          <label class="check"><input type="checkbox" class="to-routine"><span>Agregar a mi rutina</span></label>
          <button type="button" class="btn sm ghost remove-extra">✕ Quitar</button>
        </div>` : `<details class="swap"><summary>⇄ Cambiar ejercicio (si usaste otra máquina)</summary>
        <input type="hidden" class="pick" value="${chosen}">
        <div class="picker">${pickerHTML()}</div></details>`}
    </article>`;
  }

  // ------------------------------------------------------------ buscador de ejercicios
  // Se usa en "Cambiar ejercicio" y en "Agregar ejercicio adicional": filtra mientras
  // escribís (sin importar tildes ni mayúsculas) por nombre, músculo y equipo, oculta
  // los ejercicios que ya están en la pantalla y permite crear un ejercicio nuevo.
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sortCatalog = () => data.catalog.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const pickerHTML = () => `
    <input type="search" class="pick-q" placeholder="Buscar por nombre, músculo o equipo…" autocomplete="off" enterkeyhint="search" aria-label="Buscar ejercicio">
    <div class="pick-list" role="listbox" aria-label="Ejercicios"></div>
    <form class="pick-new" hidden novalidate></form>`;

  /** Ejercicios que ya están en pantalla (tarjetas de la rutina y adicionales), salvo `except`. */
  function usedIds(except = null) {
    const ids = new Set();
    for (const c of $$('.ex-card', view)) {
      if (c === except) continue;
      ids.add(c.dataset.ex);
      const p = $('.pick', c); if (p) ids.add(p.value);
    }
    return ids;
  }

  /** Coincidencias de la búsqueda agrupadas por músculo (el músculo indicado primero). */
  function pickGroups(query, firstMuscle, exclude, current) {
    const words = norm(query).split(' ').filter(Boolean);
    const hits = data.catalog.filter((c) => {
      if (exclude.has(c.id) && c.id !== current) return false;
      const hay = norm(`${c.name} ${c.muscle ?? ''} ${c.equipment ?? ''}`);
      return words.every((w) => hay.includes(w));
    });
    const order = [firstMuscle, ...MUSCLES].filter(Boolean);
    const rank = (m) => { const i = order.indexOf(m); return i < 0 ? 99 : i; };
    const groups = new Map();
    for (const c of hits) { const m = c.muscle ?? 'Otros'; if (!groups.has(m)) groups.set(m, []); groups.get(m).push(c); }
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'es'));
  }

  /**
   * Monta un buscador dentro de `details` (se arma al abrirlo).
   * opts: { muscle, current() → id elegido o null, exclude() → Set de ids a ocultar, onChoose(ejercicio) }
   */
  function mountPicker(details, opts) {
    const root = $('.picker', details), q = $('.pick-q', root), list = $('.pick-list', root), form = $('.pick-new', root);

    function refresh() {
      const query = q.value.trim(), current = opts.current();
      const groups = pickGroups(query, opts.muscle, opts.exclude(), current);
      const items = groups.map(([m, cs]) => `<div class="pick-group">${esc(m)}</div>${cs.map((c) => `
        <button type="button" class="pick-item ${c.id === current ? 'on' : ''}" role="option" aria-selected="${c.id === current}" data-id="${c.id}">
          <span>${esc(c.name)}${c.measurement_type === 'duration' ? ' <small>⏱ segundos</small>' : ''}</span>
          ${c.id === current ? '<b aria-hidden="true">✓</b>' : c.equipment ? `<small>${esc(c.equipment)}</small>` : ''}
        </button>`).join('')}`).join('');
      const empty = query && !groups.length;
      list.innerHTML = `${empty ? `<p class="pick-empty">Sin resultados para “${esc(query)}”</p>` : items}
        <button type="button" class="btn sm ${empty ? 'primary' : 'ghost'} pick-create">＋ Crear ejercicio${query ? ` “${esc(query)}”` : ''}</button>`;
    }

    function closeCreate() {
      form.hidden = true; form.innerHTML = '';
      list.hidden = false; q.hidden = false;
    }

    function reset() { q.value = ''; list.innerHTML = ''; closeCreate(); }

    function choose(id) {
      const c = data.catalog.find((x) => x.id === id);
      if (!c) return;
      details.open = false;
      reset();
      opts.onChoose(c);
    }

    function openCreate() {
      const name = q.value.trim();
      const muscle = opts.muscle && MUSCLES.includes(opts.muscle) ? opts.muscle : '';
      form.innerHTML = `
        <b class="pick-new-title">Nuevo ejercicio</b>
        <label class="field"><span>Nombre</span><input name="name" maxlength="80" value="${esc(name)}" placeholder="Ej: Remo en máquina Hammer" required></label>
        <div class="pick-new-row">
          <label class="field"><span>Músculo</span><select name="muscle" required>
            <option value="" ${muscle ? '' : 'selected'} disabled>Elegí…</option>
            ${MUSCLES.map((m) => `<option ${m === muscle ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="field"><span>Se mide en</span><select name="measurement_type">
            <option value="weight_reps">Kilos + reps</option><option value="duration">Segundos</option></select></label>
        </div>
        <label class="field"><span>Equipo (opcional)</span><input name="equipment" maxlength="60" placeholder="Máquina, polea, mancuernas…" list="equipmentList"></label>
        <p class="pick-new-msg" role="status"></p>
        <div class="pick-new-actions"><button type="button" class="btn sm ghost pick-cancel">Cancelar</button><button type="submit" class="btn sm primary">Crear y usar</button></div>`;
      form.hidden = false; list.hidden = true; q.hidden = true;
      (name ? $('[name=muscle]', form) : $('[name=name]', form)).focus();
    }

    /** El nombre ya existe: se ofrece usar ese (si no está ya en la pantalla). */
    function showDuplicate(dup) {
      const msg = $('.pick-new-msg', form);
      msg.className = 'pick-new-msg err';
      msg.innerHTML = opts.exclude().has(dup.id) && dup.id !== opts.current()
        ? `Ya existe <b>${esc(dup.name)}</b> y ya está en esta pantalla.`
        : `Ya existe <b>${esc(dup.name)}</b>. <button type="button" class="link pick-use" data-id="${dup.id}">Usar ese</button>`;
    }

    async function submitCreate() {
      const msg = $('.pick-new-msg', form), btn = $('[type=submit]', form);
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') ?? '').replace(/\s+/g, ' ').trim(),
        muscle: String(fd.get('muscle') ?? ''),
        measurement_type: String(fd.get('measurement_type') ?? 'weight_reps'),
        equipment: String(fd.get('equipment') ?? '').trim(),
      };
      const fail = (t) => { msg.className = 'pick-new-msg err'; msg.textContent = t; };
      if (payload.name.length < 2) return fail('Escribí el nombre del ejercicio');
      if (!payload.muscle) return fail('Elegí el grupo muscular');
      const dup = data.catalog.find((c) => norm(c.name) === norm(payload.name));
      if (dup) return showDuplicate(dup);
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const { exercise } = await api.createExercise(payload);
        data.catalog.push(exercise); sortCatalog();
        choose(exercise.id);
        toast(`Ejercicio creado: ${exercise.name}`);
      } catch (err) {
        if (err.status === 409) fail(`${err.message}. Recargá la página para verlo.`);
        else fail(err.status === 0 ? 'Sin conexión: no se creó. Probá de nuevo.' : err.message);
        btn.disabled = false; btn.textContent = 'Crear y usar';
      }
    }

    details.addEventListener('toggle', () => {
      if (!details.open) { reset(); return; }
      refresh();
      // En el celular el teclado tapa la lista: se enfoca el buscador sin saltar de golpe.
      q.focus({ preventScroll: true });
      details.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    // Buscar o completar el formulario no marca la tarjeta como "con cambios".
    root.addEventListener('input', (e) => e.stopPropagation());
    form.addEventListener('input', () => { const m = $('.pick-new-msg', form); if (m) { m.className = 'pick-new-msg'; m.textContent = ''; } });
    q.addEventListener('input', refresh);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = $('.pick-item', list);
        if (first) choose(first.dataset.id); else if (q.value.trim()) openCreate();
      } else if (e.key === 'Escape') {
        if (q.value) { q.value = ''; refresh(); } else details.open = false;
      }
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.pick-item');
      if (item) return choose(item.dataset.id);
      if (e.target.closest('.pick-create')) openCreate();
    });
    form.addEventListener('click', (e) => {
      if (e.target.closest('.pick-cancel')) { closeCreate(); refresh(); q.focus(); }
      const use = e.target.closest('.pick-use');
      if (use) choose(use.dataset.id);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); submitCreate(); });
  }

  /** "Cambiar ejercicio" de una tarjeta de la rutina. */
  function bindSwap(card, it, timed) {
    const sw = $('details.swap', card);
    if (!sw) return;
    mountPicker(sw, {
      muscle: it.muscle,
      current: () => $('.pick', card).value,
      exclude: () => usedIds(card),
      onChoose: (c) => {
        const input = $('.pick', card);
        if (input.value === c.id) return;
        input.value = c.id;
        $('.ex-name', card).textContent = c.name;
        if ((c.measurement_type === 'duration') !== timed) toast('Ese ejercicio se mide distinto: revisá las series', 'error');
        markDirty(card);
      },
    });
  }

  // ------------------------------------------------------------ ejercicios adicionales
  // Se agregan abajo de todo, solo para este entrenamiento. Con la casilla
  // "Agregar a mi rutina", al guardarlo pasa a la rutina de este día.
  function updateExtrasHead() {
    const head = $('#extrasHead');
    if (head) head.hidden = !$$('.ex-card', $('#extraList')).length;
  }

  async function addExtra(c) {
    const it = {
      exercise_id: c.id, name: c.name, muscle: c.muscle, measurement_type: c.measurement_type, extra: true,
      target: { sets: null, reps_min: null, reps_max: null, weight_kg: null }, target_change: null, last: null, saved: null,
    };
    const btn = $('#addExtra summary');
    btn.classList.add('loading');
    try { it.last = (await api.exerciseLast(c.id, date)).last; } catch { /* sin el último registro igual se puede cargar */ }
    finally { btn.classList.remove('loading'); }
    data.extras.push(it);
    $('#extraList').insertAdjacentHTML('beforeend', cardHTML(it, 0));
    const card = $$('.ex-card', $('#extraList')).at(-1);
    bindCard(card);
    updateExtrasHead();
    progress();
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function removeExtra(card, it) {
    const saved = !!it.saved && sessionId;
    if (saved || card.classList.contains('dirty')) {
      const ok = await confirmDialog('Quitar ejercicio', saved
        ? `Se van a borrar las series guardadas de ${it.name} en este entrenamiento.`
        : `Se pierden los datos cargados de ${it.name}.`, { ok: 'Quitar', danger: true });
      if (!ok) return;
    }
    if (saved) {
      try { await api.removeSessionExercise(sessionId, it.exercise_id); }
      catch (err) { toast(err.status === 0 ? 'Sin conexión: no se quitó. Probá de nuevo.' : err.message, 'error'); return; }
    }
    data.extras = data.extras.filter((x) => x !== it);
    card.remove();
    updateExtrasHead();
    progress();
    toast(`${it.name} quitado`);
  }

  /** Un adicional guardado con "Agregar a mi rutina" pasa a la lista de la rutina. */
  function moveToRoutine(card, it, added) {
    it.extra = false;
    it.target = { sets: null, reps_min: null, reps_max: null, weight_kg: null, ...added.target };
    it.position = added.position;
    data.extras = data.extras.filter((x) => x !== it);
    data.items.push(it);
    const list = $('#exList');
    if (!$('.ex-card', list)) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', cardHTML(it, data.items.length - 1));
    card.remove();
    bindCard($$('.ex-card', list).at(-1));
    updateExtrasHead();
    toast(`📋 ${it.name} agregado a tu rutina ${day}`);
  }

  // ------------------------------------------------------------ reordenar
  // Cada ejercicio tiene una manija (⠿) para arrastrarlo con el mouse o el dedo.
  // Mientras se arrastra, las tarjetas se compactan para que sea fácil moverlas.
  // El nuevo orden se guarda en la rutina (queda así para las próximas veces).
  function currentOrder(list) { return $$('.ex-card', list).map((c) => c.dataset.ex); }
  function applyOrder(list, ids) {
    data.items.sort((a, b) => ids.indexOf(a.exercise_id) - ids.indexOf(b.exercise_id));
    data.items.forEach((it, i) => (it.position = i + 1));
    $$('.ex-card', list).forEach((c, i) => { const n = $('.ex-num', c); if (n.textContent !== '✓') n.textContent = i + 1; });
  }
  async function persistOrder(list, before) {
    const ids = currentOrder(list);
    if (ids.join() === before.join()) return;
    applyOrder(list, ids);
    try { await api.saveRoutineOrder(day, ids); toast('Orden guardado'); }
    catch (err) {
      toast(err.message || 'No se pudo guardar el orden', 'error');
      for (const id of before) list.appendChild($(`.ex-card[data-ex="${id}"]`, list));
      applyOrder(list, before);
    }
  }

  function enableReorder(list) {
    if (!list || list.dataset.reorder) return;
    list.dataset.reorder = '1';

    // Teclado: flechas arriba/abajo sobre la manija.
    list.addEventListener('keydown', (e) => {
      const h = e.target.closest('.drag-handle');
      if (!h || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const card = h.closest('.ex-card'), before = currentOrder(list);
      const sib = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
      if (!sib) return;
      e.key === 'ArrowUp' ? sib.before(card) : sib.after(card);
      h.focus();
      persistOrder(list, before);
    });

    list.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.drag-handle');
      if (!h || e.button > 0) return;
      e.preventDefault();
      const card = h.closest('.ex-card');
      const before = currentOrder(list);
      const startY = e.clientY;
      let y = startY, raf = 0, started = false, ph = null, offset = 0;

      // El arrastre empieza recién cuando el puntero se mueve unos píxeles
      // (un toque simple sobre la manija no hace nada).
      const start = () => {
        started = true;
        const headTop = card.getBoundingClientRect().top;
        list.classList.add('reordering');
        document.body.classList.add('is-dragging');
        window.scrollBy(0, card.getBoundingClientRect().top - headTop); // compensar el compactado
        const r = card.getBoundingClientRect();
        offset = Math.min(r.height - 8, Math.max(8, startY - headTop));
        ph = document.createElement('div');
        ph.className = 'ex-placeholder';
        ph.style.height = r.height + 'px';
        card.before(ph);
        Object.assign(card.style, { width: r.width + 'px', left: r.left + 'px', top: (y - offset) + 'px' });
        card.classList.add('dragging');
        if (navigator.vibrate) navigator.vibrate(15);
        raf = requestAnimationFrame(tick);
      };
      const place = () => {
        card.style.top = (y - offset) + 'px';
        const others = $$('.ex-card:not(.dragging)', list);
        const next = others.find((c) => { const b = c.getBoundingClientRect(); return y < b.top + b.height / 2; });
        if (next) { if (ph.nextElementSibling !== next) next.before(ph); }
        else if (others.length && ph !== list.lastElementChild) others.at(-1).after(ph);
      };
      const tick = () => {
        const edge = 90, bottomEdge = window.innerHeight - 150;
        if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6));
        else if (y > bottomEdge) window.scrollBy(0, Math.ceil((y - bottomEdge) / 6));
        place();
        raf = requestAnimationFrame(tick);
      };
      const move = (ev) => { y = ev.clientY; if (!started && Math.abs(y - startY) > 4) start(); };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (!started) return;
        cancelAnimationFrame(raf);
        ph.replaceWith(card);
        card.classList.remove('dragging');
        card.removeAttribute('style');
        list.classList.remove('reordering');
        document.body.classList.remove('is-dragging');
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        persistOrder(list, before);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
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
    $$('.ex-card', view).forEach(bindCard);
    mountPicker($('#addExtra'), {
      muscle: null,
      current: () => null,
      exclude: () => usedIds(),
      onChoose: addExtra,
    });
    enableReorder($('#exList'));
    const fin = $('#finishBtn');
    if (fin) fin.onclick = finish;
    const re = $('#reopenBtn');
    if (re) re.onclick = async () => { try { await api.reopenWorkout(sessionId); sessionStatus = 'open'; toast('Sesión reabierta'); render(); } catch (err) { toast(err.message, 'error'); } };
  }

  function bindCard(card) {
    const it = [...data.items, ...data.extras].find((x) => x.exercise_id === card.dataset.ex);
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
    bindSwap(card, it, timed);
    $('.save', card).onclick = () => save(card, it, timed);
    const rm = $('.remove-extra', card);
    if (rm) rm.onclick = () => removeExtra(card, it);
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
      const exerciseId = $('.pick', card)?.value ?? it.exercise_id;
      const toRoutine = !!it.extra && !!$('.to-routine', card)?.checked;
      const r = await api.saveExercise(sid, { exercise_id: exerciseId, planned_exercise_id: it.exercise_id, sets, ...(toRoutine ? { add_to_routine: true } : {}) });
      it.saved = { exercise_id: exerciseId, sets };
      card.classList.remove('dirty'); card.classList.add('saved');
      $('.ex-num', card).textContent = '✓';
      st.className = 'status ok';
      st.textContent = `✓ Guardado (${r.sets} series)${incomplete ? ` · ${incomplete} sin reps no se guardaron` : ''}`;
      if (r.target_update) {
        it.target = { sets: r.target_update.after.sets, reps_min: r.target_update.after.reps_min, reps_max: r.target_update.after.reps_max, weight_kg: r.target_update.after.weight_kg };
        it.target_change = { ...r.target_update, changed_at: null };
        const tgt = $('.ex-target', card); if (tgt) tgt.textContent = `Objetivo: ${targetText(it.target)}`;
        $('.target-change', card)?.remove();
        $('.ex-title', card).insertAdjacentHTML('beforeend', changeBadge(it.target_change));
        toast(`🎯 Nuevo objetivo en ${it.name}: ${targetText(it.target)}`);
      }
      btn.textContent = 'Actualizar';
      if (navigator.vibrate) navigator.vibrate(30);
      if (r.added_to_routine) moveToRoutine(card, it, r.added_to_routine);
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
    const extras = data.extras.filter((x) => x.saved).length;
    $('#progText').textContent = `${done} de ${total} ejercicios guardados${extras ? ` + ${extras} adicional${extras > 1 ? 'es' : ''}` : ''}`;
    $('#progSub').textContent = sessionStatus === 'completed' ? 'Finalizado ✓' : done ? 'Guardado en la nube' : '';
    $('#progBar').style.width = `${Math.round((done * 100) / total)}%`;
    const fin = $('#finishBtn'); if (fin) fin.disabled = done + extras === 0;
  }

  async function finish() {
    const pending = data.items.filter((x) => !x.saved).length;
    const extrasPending = data.extras.filter((x) => !x.saved).length;
    if (dirtyCount()) { toast('Guardá los ejercicios con cambios antes de finalizar', 'error'); return; }
    const parts = [pending ? `${pending} ejercicio${pending > 1 ? 's' : ''} de la rutina sin cargar` : '', extrasPending ? `${extrasPending} adicional${extrasPending > 1 ? 'es' : ''} sin guardar (no se van a registrar)` : ''].filter(Boolean);
    if (parts.length && !(await confirmDialog('Finalizar entrenamiento', `Quedan ${parts.join(' y ')}. ¿Finalizar igual?`, { ok: 'Finalizar' }))) return;
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
