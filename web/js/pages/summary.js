import { api } from '../api.js';
import { esc, fmt, fmtWeight, fmtInt, fmtKg, fmtSigned, fmtDate, fmtDateLong, fmtDuration, fmtVolume, daysAgo, trendChip, skeleton, chart, axisTime, axisValue, COLORS, todayBA, $ } from '../ui.js';
import { muscleMap } from '../muscle-map.js';
import { openSession } from './sessions.js';

export default async function summary(view) {
  view.innerHTML = `<div class="kpis six">${skeleton(6)}</div><div class="cols-2 section">${skeleton(2, 'chart-sk')}</div>`;
  const d = await api.overview();
  const w = d.weight, wk = d.week, st = d.strength, h = d.health;
  const today = todayBA();

  // Semana actual: lunes a domingo, marcando días entrenados.
  const trained = new Set(wk.list.map((s) => s.date));
  const days = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((l, i) => {
    const day = new Date(wk.start + 'T12:00:00'); day.setDate(day.getDate() + i);
    const iso = day.toISOString().slice(0, 10);
    return `<span class="${trained.has(iso) ? 'on' : ''} ${iso === today ? 'today' : ''}" title="${fmtDateLong(iso)}">${l}</span>`;
  }).join('');

  const open = d.open_sessions?.length
    ? `<div class="banner"><span>⚠</span><div><b>Tenés ${d.open_sessions.length === 1 ? 'una sesión sin finalizar' : `${d.open_sessions.length} sesiones sin finalizar`}</b><br>
       ${d.open_sessions.map((s) => `<a href="#/registrar/${encodeURIComponent(s.title)}/${s.date}">${esc(s.title)} del ${fmtDate(s.date)}</a>`).join(' · ')}
       <br><span class="small">Abrila para completarla o tocá "Finalizar".</span></div></div>` : '';

  const remaining = w.remaining;
  const healthItem = (label, item, fmtFn) => `<div><span class="eyebrow">${label}</span><b class="num">${item ? fmtFn(item.value) : '—'}</b><small class="muted">${item ? daysAgo(item.date) : 'sin datos'}</small></div>`;

  view.innerHTML = `
    ${open}
    <div class="kpis six">
      <a class="card kpi link-card" href="#/peso">
        <span class="eyebrow">Peso actual</span>
        <div class="value num">${w.latest ? fmtWeight(w.latest.weight_kg) : '—'}<small>kg</small></div>
        <div class="foot">${trendChip(w.change_4w, { d: 2, unit: ' kg', goodWhenUp: false, label: '4 sem' })}<span>${w.latest ? daysAgo(w.latest.date) : ''}</span></div>
      </a>
      <a class="card kpi link-card" href="#/peso">
        <span class="eyebrow">Objetivo ${w.target ? fmtKg(w.target, 0) : ''}</span>
        <div class="value num">${remaining !== null && remaining !== undefined ? fmt(Math.max(0, remaining), 1) : '—'}<small>kg restantes</small></div>
        <div class="foot">${w.eta_weeks ? `<span class="chip neutral">≈ ${w.eta_weeks} sem. al ritmo actual</span>` : w.trend_kg_week !== null && w.trend_kg_week !== undefined ? `<span>Tendencia ${fmtSigned(w.trend_kg_week, 2)} kg/sem</span>` : ''}</div>
      </a>
      <a class="card kpi link-card" href="#/registrar">
        <span class="eyebrow">Entrenamientos esta semana</span>
        <div class="value num">${wk.sessions}<small>/ ${wk.goal}</small></div>
        <div class="week-dots">${days}</div>
      </a>
      <a class="card kpi link-card" href="#/fuerza">
        <span class="eyebrow">Progreso de fuerza · 28 días</span>
        <div class="value num">${st.progress_pct !== null ? fmtSigned(st.progress_pct, 1) : '—'}<small>%</small></div>
        <div class="foot"><span>Mediana del 1RM estimado vs. 28 días previos</span></div>
      </a>
      <a class="card kpi link-card" href="#/fuerza">
        <span class="eyebrow">Volumen · 28 días</span>
        <div class="value num">${fmtVolume(st.volume_28d).replace(/ (t|kg)$/, '<small>$1</small>')}</div>
        <div class="foot">${trendChip(st.volume_change_pct)}<span>${st.sessions_28d} sesiones</span></div>
      </a>
      <a class="card kpi link-card" href="#/salud">
        <span class="eyebrow">Pasos</span>
        <div class="value num">${h.steps ? fmtInt(h.steps.value) : '—'}</div>
        <div class="foot"><span>${h.steps ? `Último dato ${fmtDate(h.steps.date)} · ${daysAgo(h.steps.date)}` : 'Sin datos'}</span></div>
      </a>
    </div>

    <div class="cols-2 section">
      <div class="card">
        <div class="card-head"><div><h2>Evolución del peso</h2><p>Registros manuales${w.target ? ` · objetivo ${fmtKg(w.target, 0)}` : ''}</p></div>
          <a class="btn sm" href="#/peso">＋ Cargar peso</a></div>
        <div class="chart" id="cWeight"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Última sesión de fuerza</h2>
          <p>${d.last_session ? `${esc(d.last_session.title)} · ${fmtDateLong(d.last_session.date)}` : 'Todavía no hay sesiones'}</p></div>
          ${d.last_session ? `<button class="btn sm" id="openLast">Ver detalle</button>` : ''}</div>
        ${d.last_session ? `${muscleMap(d.last_session.muscles, { compact: true })}
          <div class="row between section small muted"><span>${d.last_session.exercises.length} ejercicios · ${d.last_session.sets} series</span><span>${fmtVolume(d.last_session.volume)} de volumen</span></div>`
          : `<a class="btn primary" href="#/registrar">Registrar el primero</a>`}
      </div>
    </div>

    <div class="cols-2 section">
      <div class="card">
        <div class="card-head"><div><h2>Volumen semanal</h2><p>Kilos totales levantados por semana (series × reps × peso)</p></div><a class="btn sm ghost" href="#/fuerza">Ver análisis</a></div>
        <div class="chart sm" id="cVolume"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Recuperación</h2><p>Últimos datos disponibles de Garmin</p></div><a class="btn sm ghost" href="#/salud">Ver más</a></div>
        <div class="mini-kpis health-mini">
          ${healthItem('Sueño', h.sleep_seconds, fmtDuration)}
          ${healthItem('HRV', h.hrv_rmssd, (v) => `${fmt(v, 0)} ms`)}
          ${healthItem('FC reposo', h.resting_hr, (v) => `${fmt(v, 0)} lpm`)}
        </div>
        <p class="muted small section">Estos datos se actualizarán automáticamente cuando conectemos Garmin Connect.</p>
      </div>
    </div>`;

  if (d.last_session) $('#openLast').onclick = () => openSession(d.last_session.kind, d.last_session.id);

  const series = w.series.map((p) => [p.date, p.weight_kg]);
  chart($('#cWeight'), {
    xAxis: axisTime(),
    yAxis: axisValue({ axisLabel: { color: COLORS.text, formatter: (v) => fmt(v, 0) } }),
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtKg(v, 2) },
    series: [
      { name: 'Peso', type: 'line', data: series, smooth: 0.3, symbol: 'circle', symbolSize: 7, lineStyle: { width: 3, color: COLORS.accent }, itemStyle: { color: COLORS.accent },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(237,25,57,.28)' }, { offset: 1, color: 'rgba(237,25,57,0)' }]) },
        markLine: w.target ? { symbol: 'none', silent: true, lineStyle: { type: 'dashed', color: COLORS.green }, label: { color: COLORS.green, formatter: `Objetivo ${fmt(w.target, 0)} kg`, position: 'insideEndTop' }, data: [{ yAxis: w.target }] } : undefined },
    ],
  });

  chart($('#cVolume'), {
    xAxis: { type: 'category', data: st.weekly.map((x) => fmtDate(x.week)), axisLabel: { color: COLORS.text, fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.grid } } },
    yAxis: axisValue({ scale: false, axisLabel: { color: COLORS.text, formatter: (v) => (v >= 1000 ? fmt(v / 1000, 0) + ' t' : v) } }),
    tooltip: { trigger: 'axis', formatter: (p) => `Semana del ${p[0].axisValue}<br><b>${fmtVolume(p[0].value)}</b> · ${st.weekly[p[0].dataIndex].sessions} sesiones` },
    series: [{ type: 'bar', data: st.weekly.map((x) => x.volume), barMaxWidth: 34, itemStyle: { color: COLORS.accent, borderRadius: [6, 6, 0, 0] } }],
  });
}
