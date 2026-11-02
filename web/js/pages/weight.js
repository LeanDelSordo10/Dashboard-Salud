import { api } from '../api.js';
import { esc, fmt, fmtWeight, fmtKg, fmtSigned, fmtDate, fmtDateLong, daysAgo, todayBA, trendChip, toast, confirmDialog, skeleton, emptyState, chart, axisTime, axisValue, COLORS, $, $$ } from '../ui.js';

export default async function weight(view, { setSub }) {
  const load = async () => {
    view.innerHTML = `<div class="cols-2">${skeleton(2, 'chart-sk')}</div>`;
    const d = await api.weight();
    const s = d.summary, recs = [...d.records].reverse();
    setSub(s.latest ? `Último registro ${daysAgo(s.latest.date)}` : '');
    const todayRec = d.records.find((r) => r.date === todayBA());

    view.innerHTML = `
      <div class="cols-2">
        <div class="card">
          <div class="card-head"><div><h2>Registrar peso</h2><p>Se guarda al instante en la nube. Si ya hay un registro en esa fecha, se reemplaza.</p></div></div>
          <form class="weight-form" id="wForm" novalidate>
            <label class="field big-input full"><span>Peso (kg)</span><input id="wKg" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="${s.latest ? fmt(s.latest.weight_kg, 1) : '0,0'}" value="${todayRec ? fmtWeight(todayRec.weight_kg) : ''}"></label>
            <label class="field"><span>Fecha</span><input id="wDate" type="date" value="${todayBA()}" max="${todayBA()}"></label>
            <label class="field"><span>Nota (opcional)</span><input id="wNote" maxlength="300" placeholder="En ayunas, post-entreno…" value="${esc(todayRec?.notes ?? '')}"></label>
            <button class="btn primary block full" id="wSave" type="submit">${todayRec ? 'Actualizar peso de hoy' : 'Guardar peso'}</button>
            <p class="form-msg full" id="wMsg" role="status"></p>
          </form>
        </div>
        <div class="kpis" style="--cols:2">
          <div class="card kpi"><span class="eyebrow">Actual</span><div class="value num">${s.latest ? fmtWeight(s.latest.weight_kg) : '—'}<small>kg</small></div><div class="foot">${s.latest ? fmtDate(s.latest.date) : ''}</div></div>
          <div class="card kpi"><span class="eyebrow">Últimas 4 semanas</span><div class="value num">${fmtSigned(s.change_4w, 2)}<small>kg</small></div><div class="foot">desde ${fmtDate(s.change_4w_from)}</div></div>
          <div class="card kpi"><span class="eyebrow">Desde el inicio</span><div class="value num">${fmtSigned(s.change_total, 2)}<small>kg</small></div><div class="foot">desde ${s.first ? fmtDate(s.first.date) : '—'}</div></div>
          <div class="card kpi"><span class="eyebrow">Objetivo ${d.target ? fmtKg(d.target, 0) : ''}</span><div class="value num">${s.remaining !== null && s.remaining !== undefined ? fmt(Math.max(0, s.remaining), 1) : '—'}<small>kg</small></div>
            <div class="foot">${s.trend_kg_week !== null && s.trend_kg_week !== undefined ? trendChip(s.trend_kg_week, { d: 2, unit: ' kg/sem', goodWhenUp: false }) : ''}${s.eta_weeks ? `<span>≈ ${s.eta_weeks} sem</span>` : ''}</div></div>
        </div>
      </div>

      <div class="card section">
        <div class="card-head"><div><h2>Evolución</h2><p>Registros, promedio móvil de 3 mediciones y objetivo</p></div></div>
        ${d.records.length ? '<div class="chart lg" id="cW"></div>' : emptyState('⚖', 'Todavía no hay registros de peso')}
      </div>

      <div class="card section">
        <div class="card-head"><div><h2>Historial</h2><p>${d.records.length} registros</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Fecha</th><th class="r">Peso</th><th class="r">Cambio</th><th>Nota</th><th></th></tr></thead>
          <tbody>${recs.map((r, i) => {
            const prev = recs[i + 1];
            const ch = prev ? r.weight_kg - prev.weight_kg : null;
            return `<tr><td>${fmtDateLong(r.date)}</td><td class="r"><b>${fmtWeight(r.weight_kg)} kg</b></td>
              <td class="r">${ch !== null ? trendChip(ch, { d: 2, unit: ' kg', goodWhenUp: false }) : '<span class="muted">—</span>'}</td>
              <td class="muted">${esc(r.notes ?? '')}</td>
              <td class="r"><button class="btn sm ghost" data-edit="${r.date}">Editar</button> <button class="btn sm danger" data-del="${r.id}" data-date="${r.date}">Borrar</button></td></tr>`;
          }).join('')}</tbody></table></div>
      </div>`;

    $('#wForm').onsubmit = async (e) => {
      e.preventDefault();
      const msg = $('#wMsg'), btn = $('#wSave');
      const raw = $('#wKg').value.trim().replace(',', '.');
      const kg = Number(raw);
      if (!raw || !Number.isFinite(kg) || kg <= 20 || kg >= 400) { msg.className = 'form-msg full error'; msg.textContent = 'Ingresá un peso válido, por ejemplo 89,8'; $('#wKg').focus(); return; }
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await api.saveWeight({ date: $('#wDate').value, weight_kg: kg, notes: $('#wNote').value });
        toast(`Peso guardado: ${fmtKg(kg, 2)}`);
        await load();
      } catch (err) {
        msg.className = 'form-msg full error'; msg.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Reintentar';
      }
    };
    $$('[data-edit]', view).forEach((b) => (b.onclick = () => {
      const r = d.records.find((x) => x.date === b.dataset.edit);
      $('#wDate').value = r.date; $('#wKg').value = fmtWeight(r.weight_kg); $('#wNote').value = r.notes ?? '';
      $('#wSave').textContent = `Actualizar ${fmtDate(r.date)}`;
      $('#wKg').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    $$('[data-del]', view).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('Borrar registro', `Se borrará el peso del ${fmtDate(b.dataset.date)}. No se puede deshacer.`, { ok: 'Borrar', danger: true }))) return;
      try { await api.deleteWeight(b.dataset.del); toast('Registro borrado'); await load(); } catch (err) { toast(err.message, 'error'); }
    }));

    if (d.records.length) {
      const pts = d.records.map((r) => [r.date, r.weight_kg]);
      const ma = d.records.map((r, i) => {
        const win = d.records.slice(Math.max(0, i - 2), i + 1);
        return [r.date, Math.round((win.reduce((a, x) => a + x.weight_kg, 0) / win.length) * 100) / 100];
      });
      const vals = d.records.map((r) => r.weight_kg).concat(d.target ? [d.target] : []);
      chart($('#cW'), {
        legend: { top: 0, right: 0, textStyle: { color: COLORS.text } },
        grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
        xAxis: axisTime(),
        yAxis: axisValue({ min: Math.floor(Math.min(...vals) - 1), max: Math.ceil(Math.max(...vals) + 1), axisLabel: { color: COLORS.text, formatter: (v) => fmt(v, 0) } }),
        tooltip: { trigger: 'axis', valueFormatter: (v) => fmtKg(v, 2) },
        series: [
          { name: 'Registro', type: 'line', data: pts, symbol: 'circle', symbolSize: 8, lineStyle: { width: 1.5, color: 'rgba(237,25,57,.55)' }, itemStyle: { color: COLORS.accent } },
          { name: 'Promedio móvil', type: 'line', data: ma, smooth: 0.35, symbol: 'none', lineStyle: { width: 3, color: COLORS.textStrong } },
          ...(d.target ? [{ name: 'Objetivo', type: 'line', data: [], markLine: { symbol: 'none', silent: true, lineStyle: { type: 'dashed', color: COLORS.green }, label: { color: COLORS.green, formatter: `${fmt(d.target, 0)} kg`, position: 'insideEndTop' }, data: [{ yAxis: d.target }] } }] : []),
        ],
      });
    }
  };
  await load();
}
