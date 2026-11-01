import dashboard_ui
import app_core


def _kind(row):
    text = f"{row.get('sport_type') or ''} {row.get('sub_sport_type') or ''} {row.get('title') or ''}".lower()
    if any(k in text for k in ('strength', 'fuerza', 'gym', 'weight', 'weights')):
        return 'strength'
    if any(k in text for k in ('tennis', 'tenis')):
        return 'tennis'
    if any(k in text for k in ('padel', 'pádel')):
        return 'padel'
    if any(k in text for k in ('football', 'soccer', 'futbol', 'fútbol')):
        return 'football'
    if any(k in text for k in ('run', 'running', 'correr', 'jog')):
        return 'running'
    return 'other'


def synced_tredict_activities(force=False):
    try:
        rows = app_core.select(
            'tredict_activities',
            'select=id,activity_date,local_date,sport_type,sub_sport_type,title,duration_total_s,duration_active_s,calories,hr_avg,hr_max,effort,distance_m,timezone,raw_json&order=activity_date.desc&limit=5000'
        )
    except Exception:
        rows = []
    if not rows:
        # Hasta que se ejecute la primera sincronización, conserva el fallback en vivo.
        return dashboard_ui._tredict_activities_live(force) if hasattr(dashboard_ui, '_tredict_activities_live') else []
    out = []
    for r in rows:
        out.append({
            'id': r.get('id'),
            'date': str(r.get('local_date') or r.get('activity_date') or '')[:10],
            'title': r.get('title') or r.get('sub_sport_type') or r.get('sport_type') or 'Actividad',
            'sport': r.get('sub_sport_type') or r.get('sport_type') or '',
            'kind': _kind(r),
            'duration_s': r.get('duration_total_s') or r.get('duration_active_s'),
            'calories': r.get('calories'),
            'hr_avg': r.get('hr_avg'),
            'hr_max': r.get('hr_max'),
            'effort': r.get('effort'),
            'distance_m': r.get('distance_m'),
            'raw': r.get('raw_json') or {},
        })
    return out


if not hasattr(dashboard_ui, '_tredict_activities_live'):
    dashboard_ui._tredict_activities_live = dashboard_ui._tredict_activities

dashboard_ui._tredict_activities = synced_tredict_activities
