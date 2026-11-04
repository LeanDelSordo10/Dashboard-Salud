import { api } from '../api.js';
import { esc, fmt, fmtInt, fmtKg, fmtSigned, fmtDate, fmtVolume, trendChip, skeleton, emptyState, periodPicker, chart, axisTime, axisValue, COLORS, $, $$ } from '../ui.js';
import { muscleMap } from '../muscle-map.js';
import { openSession } from './sessions.js';

let period = 'month';

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Selector de ejercicio con buscador (reemplaza al desplegable).
 * Filtra mientras escribís por nombre o músculo, sin importar tildes ni mayúsculas.
 * Devuelve select(key) para elegir uno desde afuera (p. ej. la tabla de ejercicios).
 */
function exercisePicker(root, keys, series, onChange) {
  const btn = $('.ex-pick-btn', root), pop = $('.ex-pick-pop', root), q = $('.pick-q', root), list = $('.pick-list', root);
  let current = null;

  const render = () => {
    const words = norm(q.value).split(' ').filter(Boolean);
    const hits = keys.filter((k) => { const hay = norm(`${series[k].name} ${series[k].muscle}`); return words.every((w) => hay.includes(w)); });
    const groups = new Map();
    for (const k of hits) { const m = series[k].muscle || 'Otros'; if (!groups.has(m)) groups.set(m, []); groups.get(m).push(k); }
    const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
    list.innerHTML = ordered.length ? ordered.map(([m, ks]) => `<div class="pick-group">${esc(m)}</div>${ks.map((k) => `
      <button type="button" class="pick-item ${k === current ? 'on' : ''}" role="option" aria-selected="${k === current}" data-key="${esc(k)}">
        <span>${esc(series[k].name)}</span>${k === current ? '<b aria-hidden="true">✓</b>' : `<small>${series[k].points.length} ${series[k].points.length === 1 ? 'sesión' : 'sesiones'}</small>`}
      </button>`).join('')}`).join('')
      : `<p class="pick-empty">Sin resultados para “${esc(q.value.trim())}”</p>`;
  };
  const open = () => {
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); root.classList.add('open');
    q.value = ''; render(); q.focus({ preventScroll: true });
  };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); root.classList.remove('open'); };
  const select = (key) => {
    if (!series[key]) return;
    const changed = key !== current;
    current = key;
    $('.ex-pick-name', root).textContent = series[key].name;
    btn.title = series[key].name;
    close();
    if (changed) onChange(key);
  };

  btn.onclick = () => (pop.hidden ? open() : close());
  q.oninput = render;
  q.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const f = $('.pick-item', list); if (f) select(f.dataset.key); }
    else if (e.key === 'Escape') { if (q.value) { q.value = ''; render(); } else { close(); btn.focus(); } }
  };
  list.onclick = (e) => { const it = e.target.closest('.pick-item'); if (it) select(it.dataset.key); };
  // Tocar fuera del selector lo cierra (y el listener se quita solo al cambiar de página).
  const outside = (e) => {
    if (!document.body.contains(root)) { document.removeEventListener('pointerdown', outside); return; }
    if (!pop.hidden && !root.contains(e.target)) close();
  };
  document.addEventListener('pointerdown', outside);
  return select;
}

export default async function strength(view, { setSub }) {
  const load = async () => {
    view.innerHTML = `<div class="toolbar">${periodPicker(period)}</div><div class="kpis">${skeleton(4)}</div><div class="cols-2 section">${skeleton(2, 'chart-sk')}</div>`;
    bindPeriod();
    const d = await api.strength(period);
    const m = d.metrics;
    setSub(`${fmtDate(d.start)} – ${fmtDate(d.end)}`);
    const keys = Object.keys(d.series).filter((k) => d.series[k].points.some((p) => p.e1rm));
    keys.sort((a, b) => d.series[b].points.length - d.series[a].points.length);
    const statsKey = new Set(d.exercise_stats.map((x) => x.exercise_key));
    const first = keys.find((k) => statsKey.has(k)) ?? keys[0];

    view.innerHTML = `
      <div class="toolbar">${periodPicker(period)}<a class="btn primary" href="#/registrar">＋ Registrar entrenamiento</a></div>
      <div class="kpis">
        <div class="card kpi"><span class="eyebrow">Sesiones</span><div class="value num">${m.sessions}</div><div class="foot">${m.sets} series · ${fmtInt(m.reps)} reps</div></div>
        <div class="card kpi"><span class="eyebrow">Volumen total</span><div class="value num">${fmtVolume(m.volume).replace(/ (t|kg)$/, '<small>$1</small>')}</div><div class="foot">${trendChip(m.volume_change_pct, { label: 'vs. período anterior' })}</div></div>
        <div class="card kpi"><span class="eyebrow">Progreso de fuerza</span><div class="value num">${m.progress_pct !== null ? fmtSigned(m.progress_pct) : '—'}<small>%</small></div><div class="foot">Mediana del cambio de 1RM estimado</div></div>
        <div class="card kpi"><span class="eyebrow">Ejercicios trabajados</span><div class="value num">${d.exercise_stats.length}</div><div class="foot">${d.muscles.filter((x) => x.sets >= 1).length} grupos musculares</div></div>
      </div>

      ${keys.length ? `<div class="card section">
        <div class="card-head"><div><h2>Evolución por ejercicio</h2><p>1RM estimado (fórmula de Epley) y peso máximo por sesión. Incluye historial manual y de Garmin.</p></div>
          <div class="ex-pick" id="exPick">
            <button type="button" class="ex-pick-btn" aria-haspopup="listbox" aria-expanded="false"><span class="ex-pick-name"></span><span class="ex-pick-caret" aria-hidden="true">▾</span></button>
            <div class="ex-pick-pop" hidden>
              <input type="search" class="pick-q" placeholder="Buscar ejercicio o músculo…" autocomplete="off" enterkeyhint="search" aria-label="Buscar ejercicio">
              <div class="pick-list" role="listbox" aria-label="Ejercicios"></div>
            </div>
          </div></div>
        <div class="chart lg" id="cEx"></div></div>` : ''}

      <div class="cols-2 section">
        <div class="card"><div class="card-head"><div><h2>Volumen semanal</h2><p>Kilos totales por semana</p></div></div><div class="chart" id="cWeekly"></div></div>
        <div class="card"><div class="card-head"><div><h2>Grupos musculares</h2><p>Series en el período (las secundarias cuentan ½)</p></div></div>
          ${d.muscles.length ? muscleMap(d.muscles, { compact: true }) : emptyState('💪', 'Sin series en el período')}</div>
      </div>

      <div class="card section">
        <div class="card-head"><div><h2>Ejercicios</h2><p>Ordenados por volumen. Tocá uno para ver su evolución.</p></div></div>
        ${d.exercise_stats.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Ejercicio</th><th>Músculo</th><th class="r">Series</th><th class="r">Peso máx.</th><th class="r">e1RM</th><th class="r">Cambio</th><th class="r">Volumen</th></tr></thead>
          <tbody>${d.exercise_stats.map((x) => `<tr class="clickable" data-key="${x.exercise_key}">
            <td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.muscle)}</td><td class="r">${x.sets}</td>
            <td class="r">${fmtKg(x.top_weight)}</td><td class="r">${x.best_e1rm ? fmtKg(x.best_e1rm) : '—'}</td>
            <td class="r">${x.e1rm_change_pct !== null && x.e1rm_change_pct !== undefined ? trendChip(x.e1rm_change_pct) : '<span class="muted">—</span>'}</td>
            <td class="r">${fmtVolume(x.volume)}</td></tr>`).join('')}</tbody></table></div>`
          : emptyState('📈', 'No hay series en este período', 'Elegí un período más largo para ver tu historial.')}
      </div>

      <div class="card section">
        <div class="card-head"><div><h2>Sesiones del período</h2></div><a class="btn sm ghost" href="#/sesiones">Ver todas</a></div>
        <div class="list">${d.sessions.slice(0, 8).map((s) => `
          <button class="list-item" data-kind="${s.kind}" data-id="${s.id}">
            <div class="date-badge"><b>${new Date(s.date + 'T12:00:00').getDate()}</b><small>${fmtDate(s.date, { month: 'short' })}</small></div>
            <div class="grow"><div class="title">${esc(s.title)}</div><div class="muted small">${s.sets} series · ${fmtVolume(s.volume)}</div></div>
            <span class="tag ${s.kind}">${s.kind === 'garmin' ? 'Garmin' : 'Manual'}</span></button>`).join('') || '<p class="muted">Sin sesiones.</p>'}</div>
      </div>`;
    bindPeriod();

    const drawEx = (key) => {
      const s = d.series[key];
      if (!s) return;
      chart($('#cEx'), {
        legend: { top: 0, right: 0, textStyle: { color: COLORS.text } },
        grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
        xAxis: axisTime(),
        yAxis: axisValue({ axisLabel: { color: COLORS.text, formatter: (v) => fmt(v, 0) } }),
        tooltip: { trigger: 'axis', valueFormatter: (v) => (v === null || v === undefined ? '—' : fmtKg(v)) },
        series: [
          { name: '1RM estimado', type: 'line', smooth: 0.25, symbolSize: 8, data: s.points.map((p) => [p.date, p.e1rm]), lineStyle: { width: 3, color: COLORS.accent }, itemStyle: { color: COLORS.accent } },
          { name: 'Peso máximo', type: 'line', smooth: 0.25, symbolSize: 6, data: s.points.map((p) => [p.date, p.top_weight]), lineStyle: { width: 2, type: 'dashed', color: COLORS.blue }, itemStyle: { color: COLORS.blue } },
        ],
      });
    };
    const pick = $('#exPick');
    const select = pick ? exercisePicker(pick, keys, d.series, (key) => { echarts.getInstanceByDom($('#cEx'))?.dispose(); drawEx(key); }) : null;
    if (first) select?.(first);
    $$('tr[data-key]', view).forEach((tr) => (tr.onclick = () => {
      if (!select || !d.series[tr.dataset.key]) return;
      select(tr.dataset.key); $('#cEx').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    $$('[data-kind]', view).forEach((b) => (b.onclick = () => openSession(b.dataset.kind, b.dataset.id, load)));

    chart($('#cWeekly'), {
      xAxis: { type: 'category', data: d.weekly.map((x) => fmtDate(x.week)), axisLabel: { color: COLORS.text, fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.grid } } },
      yAxis: axisValue({ scale: false, axisLabel: { color: COLORS.text, formatter: (v) => (v >= 1000 ? fmt(v / 1000, 0) + ' t' : v) } }),
      tooltip: { trigger: 'axis', formatter: (p) => `Semana del ${p[0].axisValue}<br><b>${fmtVolume(p[0].value)}</b> · ${d.weekly[p[0].dataIndex].sessions} sesiones` },
      series: [{ type: 'bar', data: d.weekly.map((x) => x.volume), barMaxWidth: 30, itemStyle: { color: COLORS.accent, borderRadius: [6, 6, 0, 0] } }],
    });
  };
  const bindPeriod = () => $$('[data-period]', view).forEach((b) => (b.onclick = () => { period = b.dataset.period; load(); }));
  await load();
}
