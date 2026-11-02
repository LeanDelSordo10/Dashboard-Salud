import { api } from '../api.js';
import { fmt, fmtInt, fmtDate, fmtDuration, skeleton, emptyState, periodPicker, chart, axisTime, axisValue, COLORS, $, $$ } from '../ui.js';

let period = 'quarter';

export default async function health(view, { setSub }) {
  const load = async () => {
    view.innerHTML = `<div class="toolbar">${periodPicker(period)}</div><div class="kpis">${skeleton(4)}</div>`;
    bind();
    const d = await api.health(period);
    const rows = d.rows, g = d.goals ?? {};
    setSub(`${fmtDate(d.start)} – ${fmtDate(d.end)}`);
    const vals = (f) => rows.map((r) => r[f]).filter((v) => v !== null);
    const avg = (f) => { const v = vals(f); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const stepsGoal = g.daily_steps_goal, sleepGoal = g.nightly_sleep_hours_goal;
    const stepDays = vals('steps');
    const goalDays = stepsGoal ? stepDays.filter((v) => v >= stepsGoal).length : null;

    view.innerHTML = `
      <div class="toolbar">${periodPicker(period)}</div>
      <div class="banner info"><span>ℹ</span><div>Datos históricos importados de Garmin y Tredict${d.latest_date ? ` (último registro: <b>${fmtDate(d.latest_date, { day: 'numeric', month: 'long' })}</b>)` : ''}. Se actualizarán solos cuando conectemos Garmin Connect.</div></div>
      ${rows.length ? `
      <div class="kpis">
        <div class="card kpi"><span class="eyebrow">Pasos promedio</span><div class="value num">${fmtInt(avg('steps'))}</div><div class="foot">${goalDays !== null && stepDays.length ? `${goalDays} de ${stepDays.length} días cumpliste ${fmtInt(stepsGoal)}` : ''}</div></div>
        <div class="card kpi"><span class="eyebrow">Sueño promedio</span><div class="value num">${fmtDuration(avg('sleep_seconds'))}</div><div class="foot">${sleepGoal ? `Objetivo ${fmt(sleepGoal)} h` : ''}</div></div>
        <div class="card kpi"><span class="eyebrow">HRV promedio</span><div class="value num">${fmt(avg('hrv_rmssd'), 0)}<small>ms</small></div><div class="foot">Más alto suele indicar mejor recuperación</div></div>
        <div class="card kpi"><span class="eyebrow">FC en reposo</span><div class="value num">${fmt(avg('resting_hr'), 0)}<small>lpm</small></div><div class="foot">Más bajo suele indicar mejor estado</div></div>
      </div>
      <div class="cols-2-even section">
        <div class="card"><div class="card-head"><div><h2>Pasos diarios</h2><p>${stepsGoal ? `Objetivo ${fmtInt(stepsGoal)}` : ''}</p></div></div>${stepDays.length ? '<div class="chart" id="cSteps"></div>' : emptyState('👟', 'Sin pasos en este período')}</div>
        <div class="card"><div class="card-head"><div><h2>Sueño</h2><p>Horas por noche</p></div></div>${vals('sleep_seconds').length ? '<div class="chart" id="cSleep"></div>' : emptyState('🌙', 'Sin datos de sueño en este período')}</div>
      </div>
      <div class="card section"><div class="card-head"><div><h2>Recuperación</h2><p>HRV (ms) y frecuencia cardíaca en reposo (lpm)</p></div></div><div class="chart" id="cRec"></div></div>`
      : `<div class="card">${emptyState('📉', 'No hay datos de salud en este período', 'Elegí "Todo" para ver el histórico importado.')}</div>`}`;
    bind();
    if (!rows.length) return;

    const barOpts = (el, data, color, goal, fmtFn, unit) => chart(el, {
      xAxis: axisTime(),
      yAxis: axisValue({ scale: false, axisLabel: { color: COLORS.text, formatter: fmtFn } }),
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${fmtFn(v)}${unit}` },
      series: [{ type: 'bar', data, barMaxWidth: 16, itemStyle: { color, borderRadius: [4, 4, 0, 0] },
        markLine: goal ? { symbol: 'none', silent: true, lineStyle: { type: 'dashed', color: COLORS.green }, label: { color: COLORS.green, position: 'insideEndTop', formatter: `Objetivo` }, data: [{ yAxis: goal }] } : undefined }],
    });
    if ($('#cSteps')) barOpts($('#cSteps'), rows.filter((r) => r.steps !== null).map((r) => [r.date, r.steps]), COLORS.green, stepsGoal, (v) => (v >= 1000 ? fmt(v / 1000, 0) + ' k' : v), ' pasos');
    if ($('#cSleep')) barOpts($('#cSleep'), rows.filter((r) => r.sleep_seconds !== null).map((r) => [r.date, Math.round((r.sleep_seconds / 3600) * 10) / 10]), COLORS.violet, sleepGoal, (v) => fmt(v, 1), ' h');
    chart($('#cRec'), {
      legend: { top: 0, right: 0, textStyle: { color: COLORS.text } },
      grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
      xAxis: axisTime(),
      yAxis: axisValue(),
      series: [
        { name: 'HRV', type: 'line', smooth: 0.3, symbolSize: 5, connectNulls: false, data: rows.filter((r) => r.hrv_rmssd !== null).map((r) => [r.date, r.hrv_rmssd]), lineStyle: { width: 2.5, color: COLORS.amber }, itemStyle: { color: COLORS.amber } },
        { name: 'FC reposo', type: 'line', smooth: 0.3, symbolSize: 5, data: rows.filter((r) => r.resting_hr !== null).map((r) => [r.date, r.resting_hr]), lineStyle: { width: 2.5, color: COLORS.accent }, itemStyle: { color: COLORS.accent } },
      ],
    });
  };
  const bind = () => $$('[data-period]', view).forEach((b) => (b.onclick = () => { period = b.dataset.period; load(); }));
  await load();
}
