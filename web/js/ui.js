// Utilidades de interfaz: formato es-AR, fechas, toasts, modales y gráficos.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const nf = (d) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: d });
export const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : nf(d).format(Number(v)));
export const fmtInt = (v) => fmt(v, 0);
export const fmtKg = (v, d = 1) => (v === null || v === undefined ? '—' : `${fmt(v, d)} kg`);
export const fmtSigned = (v, d = 1, unit = '') => {
  if (v === null || v === undefined) return '—';
  const s = Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : '';
  return `${s}${fmt(Math.abs(v), d)}${unit}`;
};
export const fmtPct = (v, d = 1) => fmtSigned(v, d, ' %');
export function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
export const fmtVolume = (v) => (v >= 100000 ? `${fmt(v / 1000, 1)} t` : `${fmtInt(v)} kg`);
/** Peso corporal: siempre con al menos un decimal (90,0 · 90,75). */
export const fmtWeight = (v) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(v));

/** Fecha de hoy (YYYY-MM-DD) en Buenos Aires. */
export const todayBA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const asDate = (d) => new Date(d + 'T12:00:00');
export const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => (d ? asDate(d).toLocaleDateString('es-AR', opts).replace('.', '') : '—');
export const fmtDateLong = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDateShort = (d) => fmtDate(d, { day: '2-digit', month: '2-digit' });
export function daysAgo(d) {
  if (!d) return '';
  const n = Math.round((asDate(todayBA()) - asDate(d)) / 86400000);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 7) return `hace ${n} días`;
  if (n < 60) return `hace ${Math.round(n / 7)} sem`;
  return `hace ${Math.round(n / 30)} meses`;
}

export function trendClass(v, goodWhenUp = true) {
  if (v === null || v === undefined || Math.abs(v) < 0.05) return 'neutral';
  return (v > 0) === goodWhenUp ? 'up' : 'down';
}
export function trendChip(v, { d = 1, unit = ' %', goodWhenUp = true, label = '' } = {}) {
  if (v === null || v === undefined) return `<span class="chip neutral">${label || 'sin comparación'}</span>`;
  const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
  return `<span class="chip ${trendClass(v, goodWhenUp)}">${arrow} ${fmtSigned(v, d, unit)}${label ? ' ' + label : ''}</span>`;
}

// ---------------------------------------------------------------- feedback

let toastTimer;
export function toast(message, type = 'ok') {
  const t = $('#toast');
  t.className = `toast show ${type}`;
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

export function confirmDialog(title, text, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = $('#dialog');
    d.innerHTML = `<form method="dialog" class="dialog-body"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
      <div class="dialog-actions"><button value="cancel" class="btn ghost">Cancelar</button><button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.showModal();
  });
}

export function openDrawer(html) {
  const dr = $('#drawer');
  dr.innerHTML = `<button class="icon-btn drawer-close" aria-label="Cerrar">✕</button><div class="drawer-content">${html}</div>`;
  $('.drawer-close', dr).onclick = closeDrawer;
  document.body.classList.add('drawer-open');
  return $('.drawer-content', dr);
}
export function closeDrawer() { document.body.classList.remove('drawer-open'); }

export const skeleton = (n = 4, cls = 'kpi') => Array.from({ length: n }, () => `<div class="card skeleton ${cls}"></div>`).join('');
export const emptyState = (icon, title, text = '', action = '') =>
  `<div class="empty"><div class="empty-icon">${icon}</div><b>${esc(title)}</b>${text ? `<p class="muted">${text}</p>` : ''}${action}</div>`;
export const errorState = (msg, retry = true) =>
  `<div class="card error-card"><b>No pudimos cargar esta sección</b><p class="muted">${esc(msg)}</p>${retry ? '<button class="btn ghost" data-retry>Reintentar</button>' : ''}</div>`;

export function periodPicker(current, options = ['week', 'month', 'quarter', 'year', 'all']) {
  const labels = { week: '7 días', month: '30 días', quarter: '3 meses', year: '1 año', all: 'Todo' };
  return `<div class="segmented" role="tablist">${options.map((p) => `<button data-period="${p}" class="${p === current ? 'on' : ''}">${labels[p]}</button>`).join('')}</div>`;
}

// ---------------------------------------------------------------- gráficos

const charts = new Set();
export const COLORS = { accent: '#ed1939', accentSoft: 'rgba(237,25,57,.18)', green: '#22c55e', blue: '#60a5fa', amber: '#fbbf24', violet: '#a78bfa', grid: 'rgba(148,163,184,.12)', text: '#94a3b8', textStrong: '#e2e8f0' };

export function chart(el, option) {
  if (!el || !window.echarts) return null;
  const c = echarts.init(el, null, { renderer: 'svg' });
  c.setOption({
    animationDuration: 500,
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: COLORS.text },
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', backgroundColor: '#0f1419', borderColor: '#2a313b', textStyle: { color: COLORS.textStrong, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(148,163,184,.4)' } },
    },
    ...option,
  });
  charts.add(c);
  return c;
}
export const axisTime = (extra = {}) => ({
  type: 'time', axisLine: { lineStyle: { color: COLORS.grid } }, axisTick: { show: false },
  axisLabel: { color: COLORS.text, fontSize: 11, hideOverlap: true, formatter: (v) => fmtDateShort(new Date(v).toISOString().slice(0, 10)) },
  splitLine: { show: false }, ...extra,
});
export const axisValue = (extra = {}) => ({
  type: 'value', scale: true, axisLabel: { color: COLORS.text, fontSize: 11 }, splitLine: { lineStyle: { color: COLORS.grid } }, ...extra,
});
export function disposeCharts() { for (const c of charts) c.dispose(); charts.clear(); }
window.addEventListener('resize', () => { for (const c of charts) c.resize(); });
new ResizeObserver(() => { for (const c of charts) c.resize(); }).observe(document.documentElement);
