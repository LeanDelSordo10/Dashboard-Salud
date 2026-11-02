from datetime import datetime, timezone

import requests
from flask import jsonify, request

import app_core
from fit_folder import app


BODY_GOALS = {
    'cut_preserve_muscle': 'Déficit + mantener músculo',
    'muscle_gain': 'Ganancia muscular',
    'recomposition': 'Recomposición',
    'maintenance': 'Mantenimiento',
}


def _get_goals():
    try:
        rows = app_core.select('dashboard_goals', 'select=*&id=eq.1&limit=1')
        return rows[0] if rows else {'id': 1}
    except Exception:
        return {'id': 1}


@app.get('/api/settings/goals')
@app_core.auth
def get_dashboard_goals():
    row = _get_goals()
    row['body_goal_label'] = BODY_GOALS.get(row.get('body_goal'))
    return jsonify(row)


@app.post('/api/settings/goals')
@app_core.auth
def save_dashboard_goals():
    data = request.get_json(silent=True) or {}

    def integer(name, minimum, maximum):
        raw = data.get(name)
        if raw in (None, ''):
            return None
        value = int(raw)
        if not minimum <= value <= maximum:
            raise ValueError(name)
        return value

    def number(name, minimum, maximum):
        raw = data.get(name)
        if raw in (None, ''):
            return None
        value = round(float(str(raw).replace(',', '.')), 2)
        if not minimum <= value <= maximum:
            raise ValueError(name)
        return value

    try:
        body_goal = str(data.get('body_goal') or '').strip() or None
        if body_goal not in BODY_GOALS and body_goal is not None:
            return jsonify({'error': 'Objetivo corporal inválido'}), 400
        row = {
            'id': 1,
            'daily_steps_goal': integer('daily_steps_goal', 1000, 100000),
            'weekly_intensity_minutes_goal': integer('weekly_intensity_minutes_goal', 0, 10080),
            'target_weight_kg': number('target_weight_kg', 20, 400),
            'body_goal': body_goal,
            'weekly_strength_sessions_goal': integer('weekly_strength_sessions_goal', 0, 14),
            'nightly_sleep_hours_goal': number('nightly_sleep_hours_goal', 1, 16),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
    except (ValueError, TypeError):
        return jsonify({'error': 'Revisá los valores ingresados'}), 400

    try:
        url = f"{app_core.SUPABASE_URL}/rest/v1/dashboard_goals?on_conflict=id"
        r = requests.post(
            url,
            headers=app_core.headers({'Prefer': 'resolution=merge-duplicates,return=representation'}),
            json=[row],
            timeout=20,
        )
        r.raise_for_status()
        saved = r.json()[0]
        saved['body_goal_label'] = BODY_GOALS.get(saved.get('body_goal'))
        return jsonify({'ok': True, 'goals': saved})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
