import { api } from '../api.js';
import { esc, fmt, fmtInt, fmtKg, fmtSigned, fmtDate, fmtVolume, trendChip, skeleton, emptyState, periodPicker, chart, axisTime, axisValue, COLORS, $, $$ } from '../ui.js';
import { muscleMap } from '../muscle-map.js';
import { openSession } from './sessions.js';

let period = 'month';

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
          <select id="exSel" style="max-width:280px">${keys.map((k) => `<option value="${k}" ${k === first ? 'selected' : ''}>${esc(d.series[k].name)}</option>`).join('')}</select></div>
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
    if (first) drawEx(first);
    const sel = $('#exSel');
    if (sel) sel.onchange = () => { echarts.getInstanceByDom($('#cEx'))?.dispose(); drawEx(sel.value); };
    $$('tr[data-key]', view).forEach((tr) => (tr.onclick = () => {
      if (!sel || !d.series[tr.dataset.key]) return;
      sel.value = tr.dataset.key; sel.onchange(); $('#cEx').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
