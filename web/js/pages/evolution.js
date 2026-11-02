import { api } from '../api.js';
import { esc, fmt, fmtInt, fmtKg, fmtSigned, fmtDate, fmtDuration, fmtVolume, trendChip, skeleton, periodPicker, chart, axisTime, axisValue, COLORS, $, $$ } from '../ui.js';

let period = 'month';

export default async function evolution(view, { setSub }) {
  const load = async () => {
    view.innerHTML = `<div class="toolbar">${periodPicker(period, ['week', 'month', 'quarter', 'year'])}</div><div class="card skeleton" style="min-height:110px"></div><div class="kpis three section">${skeleton(4)}</div>`;
    bind();
    const d = await api.global(period);
    const m = d.metrics;
    setSub(`${fmtDate(d.start)} – ${fmtDate(d.end)} vs. período anterior`);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const lines = [...d.conclusion.good.map((t) => `<li class="good">${esc(cap(t))}.</li>`), ...d.conclusion.warn.map((t) => `<li class="warn">${esc(cap(t))}.</li>`)];

    view.innerHTML = `
      <div class="toolbar">${periodPicker(period, ['week', 'month', 'quarter', 'year'])}</div>
      <div class="card">
        <div class="card-head"><div><h2>Conclusión del período</h2><p>Comparado con los ${fmtInt((Date.parse(d.end) - Date.parse(d.start)) / 86400000 + 1)} días anteriores</p></div></div>
        ${lines.length ? `<ul class="insights">${lines.join('')}</ul>` : '<p class="muted">Todavía no hay datos suficientes para comparar este período.</p>'}
      </div>
      <div class="kpis three section">
        <div class="card kpi"><span class="eyebrow">Constancia</span><div class="value num">${m.sessions}<small>/ ${m.sessions_expected} sesiones</small></div>
          <div class="progress"><span style="width:${m.consistency_pct ?? 0}%"></span></div><div class="foot">${fmt(m.consistency_pct, 0)} % de lo previsto</div></div>
        <div class="card kpi"><span class="eyebrow">Fuerza (e1RM)</span><div class="value num">${m.strength_pct !== null ? fmtSigned(m.strength_pct) : '—'}<small>%</small></div><div class="foot">Ejercicios repetidos en ambos períodos</div></div>
        <div class="card kpi"><span class="eyebrow">Volumen</span><div class="value num">${m.volume_pct !== null ? fmtSigned(m.volume_pct, 0) : '—'}<small>%</small></div><div class="foot">vs. período anterior</div></div>
        <div class="card kpi"><span class="eyebrow">Peso</span><div class="value num">${m.weight_delta_kg !== null ? fmtSigned(m.weight_delta_kg, 2) : '—'}<small>kg</small></div><div class="foot">${m.weight_delta_kg !== null ? trendChip(m.weight_delta_kg, { d: 2, unit: ' kg', goodWhenUp: false }) : 'Sin registros en el período'}</div></div>
        <div class="card kpi"><span class="eyebrow">Pasos promedio</span><div class="value num">${m.steps_avg !== null ? fmtInt(m.steps_avg) : '—'}</div><div class="foot">${m.steps_avg !== null ? trendChip(m.steps_pct) : 'Sin datos de Garmin en el período'}</div></div>
        <div class="card kpi"><span class="eyebrow">Sueño promedio</span><div class="value num">${m.sleep_avg_s !== null ? fmtDuration(m.sleep_avg_s) : '—'}</div><div class="foot">${m.sleep_avg_s !== null ? trendChip(m.sleep_pct) : 'Sin datos de Garmin en el período'}</div></div>
      </div>
      <div class="cols-2-even section">
        <div class="card"><div class="card-head"><div><h2>Volumen semanal</h2><p>Kilos totales por semana</p></div></div><div class="chart" id="cVol"></div></div>
        <div class="card"><div class="card-head"><div><h2>Peso</h2><p>Período actual y anterior</p></div></div><div class="chart" id="cW"></div></div>
      </div>`;
    bind();

    chart($('#cVol'), {
      xAxis: { type: 'category', data: d.weekly.map((x) => fmtDate(x.week)), axisLabel: { color: COLORS.text, fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.grid } } },
      yAxis: axisValue({ scale: false, axisLabel: { color: COLORS.text, formatter: (v) => (v >= 1000 ? fmt(v / 1000, 0) + ' t' : v) } }),
      tooltip: { trigger: 'axis', formatter: (p) => `Semana del ${p[0].axisValue}<br><b>${fmtVolume(p[0].value)}</b>` },
      series: [{ type: 'bar', data: d.weekly.map((x) => x.volume), barMaxWidth: 30, itemStyle: { color: COLORS.accent, borderRadius: [6, 6, 0, 0] } }],
    });
    chart($('#cW'), {
      xAxis: axisTime(),
      yAxis: axisValue({ axisLabel: { color: COLORS.text, formatter: (v) => fmt(v, 0) } }),
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtKg(v, 2) },
      series: [{ type: 'line', smooth: 0.3, symbolSize: 8, data: d.weights.map((w) => [w.date, w.weight_kg]), lineStyle: { width: 3, color: COLORS.accent }, itemStyle: { color: COLORS.accent },
        markArea: { silent: true, itemStyle: { color: 'rgba(255,255,255,.035)' }, data: [[{ xAxis: d.start }, { xAxis: d.end }]] } }],
    });
  };
  const bind = () => $$('[data-period]', view).forEach((b) => (b.onclick = () => { period = b.dataset.period; load(); }));
  await load();
}
