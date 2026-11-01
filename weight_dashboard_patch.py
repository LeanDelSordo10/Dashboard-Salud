"""Centraliza el peso corporal del dashboard en body_weight_records.

Garmin/Tredict pueden seguir almacenando valores históricos en daily_health, pero
ninguna card, gráfico o cálculo del dashboard recibe esos weight_kg. La única
fuente expuesta al dashboard es el registro manual.
"""
import dashboard_ui

_original_daily_all = dashboard_ui._daily_all


def _daily_all_manual_weight(limit=900):
    # Primero obtenemos el resto de las métricas diarias normalmente.
    daily = _original_daily_all(limit)

    # Eliminamos cualquier peso heredado de Garmin/Tredict para que nunca pueda
    # filtrarse accidentalmente a cards, gráficos o cálculos.
    by_date = {}
    for raw in daily:
        row = dict(raw)
        day = str(row.get('date') or '')[:10]
        if not day:
            continue
        row['weight_kg'] = None
        row['weight_source'] = None
        by_date[day] = row

    # body_weight_records pasa a ser la única fuente oficial del peso.
    weights = dashboard_ui._safe_select(
        'body_weight_records',
        f'select=measurement_date,weight_kg,measured_at,source,notes&order=measurement_date.asc&limit={int(limit)}'
    )
    for w in weights:
        day = str(w.get('measurement_date') or '')[:10]
        if not day:
            continue
        row = by_date.setdefault(day, {'date': day})
        row['weight_kg'] = w.get('weight_kg')
        row['weight_source'] = 'Registro manual'
        row['weight_measured_at'] = w.get('measured_at')

    return [by_date[k] for k in sorted(by_date)]


# Las funciones existentes de Resumen, Salud y Evolución global llaman a
# dashboard_ui._daily_all en tiempo de ejecución, por lo que este reemplazo
# aplica la misma fuente manual en todos esos lugares sin duplicar lógica.
dashboard_ui._daily_all = _daily_all_manual_weight
