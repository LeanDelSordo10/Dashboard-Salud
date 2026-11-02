import os
import time
from collections import defaultdict
from datetime import date, datetime, timedelta

import requests
from flask import jsonify, request

import app_core
from fit_folder import app
import tredict_sync


_TREDICT_CACHE = {'ts': 0.0, 'data': []}


def _safe_select(table, query=''):
    try:
        return app_core.select(table, query)
    except Exception:
        return []


def _to_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).date()
    except Exception:
        try:
            return datetime.strptime(str(value)[:10], '%Y-%m-%d').date()
        except Exception:
            return None


def _num(value):
    try:
        return float(value)
    except Exception:
        return None


def _avg(values):
    vals = [_num(v) for v in values]
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def _pct(current, previous):
    current, previous = _num(current), _num(previous)
    if current is None or previous in (None, 0):
        return None
    return (current - previous) * 100.0 / abs(previous)


def _period_days(period):
    return {'week': 7, 'month': 30, 'year': 365}.get(period, 30)


def _range(days, offset=0):
    end = date.today() - timedelta(days=offset)
    start = end - timedelta(days=days - 1)
    return start, end


def _filter_dates(rows, field, start, end):
    out = []
    for row in rows:
        d = _to_date(row.get(field))
        if d and start <= d <= end:
            out.append(row)
    return out


def _daily_all(limit=900):
    return _safe_select('daily_health', f'select=*&order=date.asc&limit={limit}')


def _exercise_map():
    return {x.get('id'): x for x in _safe_select('exercises', 'select=id,name,primary_muscle,secondary_muscles,active&order=name.asc')}


def _strength_history():
    return _safe_select('workout_set_history', 'select=*&order=performed_at.asc&limit=5000')


def _routine_days_per_week():
    rows = _safe_select('routine_exercises', 'select=day_code&order=day_code.asc&limit=1000')
    days = {str(x.get('day_code') or '').replace('%20', ' ').strip() for x in rows if x.get('day_code')}
    return len(days) or 4


def _tredict_activities(force=False):
    now = time.time()
    if not force and _TREDICT_CACHE['data'] and now - _TREDICT_CACHE['ts'] < 60:
        return _TREDICT_CACHE['data']
    token = os.getenv('TREDICT_TOKEN', '').strip()
    if not token:
        return []
    try:
        r = requests.get(
            tredict_sync.TREDICT_ACTIVITY_LIST,
            params={'pageSize': 250, 'extendedSummary': 1},
            headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json;charset=UTF-8'},
            timeout=20,
        )
        if not r.ok:
            return []
        data = r.json() if r.content else {}
        raw = data.get('activities') or data.get('activityList') or data.get('trainings') or []
        result = []
        for a in raw if isinstance(raw, list) else []:
            sport = str(a.get('sport') or a.get('activityType') or a.get('type') or a.get('misc') or '').strip()
            title = str(a.get('title') or a.get('name') or sport or 'Actividad').strip()
            d = a.get('date') or a.get('startTime') or a.get('start') or a.get('dateStart')
            duration = a.get('durationTotal') or a.get('duration') or a.get('durationSeconds') or a.get('activeDuration')
            calories = a.get('calories') or a.get('kcal') or a.get('caloriesTotal')
            hr_avg = a.get('heartrateAvg') or a.get('heartRateAvg') or a.get('hrAvg') or a.get('averageHeartrate')
            hr_max = a.get('heartrateMax') or a.get('heartRateMax') or a.get('hrMax') or a.get('maxHeartrate')
            effort = a.get('effort') or a.get('trainingEffort') or a.get('load')
            text = f'{sport} {title}'.lower()
            if any(k in text for k in ('strength', 'fuerza', 'gym', 'weight', 'weights')):
                kind = 'strength'
            elif any(k in text for k in ('tennis', 'tenis')):
                kind = 'tennis'
            elif any(k in text for k in ('padel', 'pádel')):
                kind = 'padel'
            elif any(k in text for k in ('football', 'soccer', 'futbol', 'fútbol')):
                kind = 'football'
            elif any(k in text for k in ('run', 'running', 'correr', 'jog')):
                kind = 'running'
            else:
                kind = 'other'
            result.append({
                'id': a.get('id'), 'date': str(d or '')[:10], 'title': title, 'sport': sport,
                'kind': kind, 'duration_s': _num(duration), 'calories': _num(calories),
                'hr_avg': _num(hr_avg), 'hr_max': _num(hr_max), 'effort': _num(effort), 'raw': a,
            })
        _TREDICT_CACHE.update({'ts': now, 'data': result})
        return result
    except Exception:
        return []


def _activity_minutes(rows):
    return sum((x.get('duration_s') or 0) for x in rows) / 60.0


def _daily_metric(rows, field, mode='avg'):
    vals = [_num(x.get(field)) for x in rows]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if mode == 'sum':
        return sum(vals)
    if mode == 'latest':
        return vals[-1]
    return sum(vals) / len(vals)


def _strength_metrics(rows, exmap):
    stats = defaultdict(lambda: {'sets': 0, 'reps': 0, 'volume': 0.0, 'best_e1rm': None})
    for r in rows:
        eid = r.get('exercise_id')
        reps = _num(r.get('reps')) or 0
        weight = _num(r.get('weight_kg')) or 0
        s = stats[eid]
        s['sets'] += 1
        s['reps'] += reps
        s['volume'] += weight * reps
        e1rm = weight * (1 + reps / 30.0) if weight and reps else None
        if e1rm is not None and (s['best_e1rm'] is None or e1rm > s['best_e1rm']):
            s['best_e1rm'] = e1rm
    result = []
    for eid, s in stats.items():
        ex = exmap.get(eid, {})
        result.append({
            'exercise_id': eid,
            'name': ex.get('name') or 'Ejercicio',
            'muscle': ex.get('primary_muscle') or 'Sin clasificar',
            **s,
        })
    result.sort(key=lambda x: x['volume'], reverse=True)
    return result


def _strength_progress(current, previous, exmap):
    c = {x['exercise_id']: x for x in _strength_metrics(current, exmap)}
    p = {x['exercise_id']: x for x in _strength_metrics(previous, exmap)}
    changes = []
    for eid in set(c).intersection(p):
        if c[eid]['best_e1rm'] is not None and p[eid]['best_e1rm'] not in (None, 0):
            changes.append(_pct(c[eid]['best_e1rm'], p[eid]['best_e1rm']))
    changes = [x for x in changes if x is not None]
    return sum(changes) / len(changes) if changes else None


def _overview_payload():
    daily = _daily_all()
    acts = _tredict_activities()
    today = date.today()
    last7 = [x for x in daily if (d := _to_date(x.get('date'))) and today - timedelta(days=6) <= d <= today]
    prev7 = [x for x in daily if (d := _to_date(x.get('date'))) and today - timedelta(days=13) <= d <= today - timedelta(days=7)]
    act7 = [x for x in acts if (d := _to_date(x.get('date'))) and today - timedelta(days=6) <= d <= today]
    latest = daily[-1] if daily else {}

    def latest_non_null(field):
        for row in reversed(daily):
            if row.get(field) is not None:
                return row.get(field)
        return None

    sessions = _safe_select('workout_sessions', 'select=id,date,title,status,source,created_at&order=date.desc,created_at.desc&limit=8')
    imports = _safe_select('garmin_strength_imports', 'select=id,date,title,duration_s,calories,hr_avg,hr_max,created_at&order=date.desc,created_at.desc&limit=8')
    candidates = []
    for s in sessions:
        candidates.append({'kind': 'manual', 'id': s.get('id'), 'date': s.get('date'), 'title': s.get('title') or 'Fuerza'})
    for s in imports:
        candidates.append({'kind': 'garmin', 'id': s.get('id'), 'date': s.get('date'), 'title': s.get('title') or 'Fuerza', 'duration_s': s.get('duration_s'), 'calories': s.get('calories'), 'hr_avg': s.get('hr_avg'), 'hr_max': s.get('hr_max')})
    candidates.sort(key=lambda x: str(x.get('date') or ''), reverse=True)
    last_strength = candidates[0] if candidates else None

    fit_rows = _safe_select('garmin_fit_files', 'select=folder_date,uploaded_at,status&order=uploaded_at.desc&limit=5000')
    fit_dates = sorted({str(x.get('folder_date')) for x in fit_rows if x.get('folder_date')})

    return {
        'today': today.isoformat(),
        'kpis': {
            'weight_kg': latest_non_null('weight_kg'),
            'steps': latest_non_null('steps'),
            'sleep_seconds': latest_non_null('sleep_seconds'),
            'hrv_rmssd': latest_non_null('hrv_rmssd'),
            'resting_hr': latest_non_null('resting_hr'),
            'sport_minutes_week': round(_activity_minutes(act7), 1),
        },
        'changes': {
            'steps_pct': _pct(_daily_metric(last7, 'steps'), _daily_metric(prev7, 'steps')),
            'sleep_pct': _pct(_daily_metric(last7, 'sleep_seconds'), _daily_metric(prev7, 'sleep_seconds')),
            'hrv_pct': _pct(_daily_metric(last7, 'hrv_rmssd'), _daily_metric(prev7, 'hrv_rmssd')),
            'resting_hr_pct': _pct(_daily_metric(last7, 'resting_hr'), _daily_metric(prev7, 'resting_hr')),
        },
        'recent_daily': daily[-14:],
        'last_strength': last_strength,
        'recent_activities': acts[:10],
        'sync': {
            'fit_files': len(fit_rows), 'fit_days': len(fit_dates),
            'fit_first': fit_dates[0] if fit_dates else None, 'fit_last': fit_dates[-1] if fit_dates else None,
            'fit_latest_upload': fit_rows[0].get('uploaded_at') if fit_rows else None,
        },
    }


def _global_payload(period):
    days = _period_days(period)
    s1, e1 = _range(days)
    s0, e0 = _range(days, days)
    daily = _daily_all()
    cur_d, prev_d = _filter_dates(daily, 'date', s1, e1), _filter_dates(daily, 'date', s0, e0)
    acts = _tredict_activities()
    cur_a, prev_a = _filter_dates(acts, 'date', s1, e1), _filter_dates(acts, 'date', s0, e0)
    history = _strength_history()
    cur_s, prev_s = _filter_dates(history, 'performed_at', s1, e1), _filter_dates(history, 'performed_at', s0, e0)
    exmap = _exercise_map()

    steps_pct = _pct(_daily_metric(cur_d, 'steps'), _daily_metric(prev_d, 'steps'))
    minutes_pct = _pct(_activity_minutes(cur_a), _activity_minutes(prev_a))
    activity_parts = [x for x in (steps_pct, minutes_pct) if x is not None]
    activity_pct = sum(activity_parts) / len(activity_parts) if activity_parts else None
    sleep_pct = _pct(_daily_metric(cur_d, 'sleep_seconds'), _daily_metric(prev_d, 'sleep_seconds'))
    hrv_pct = _pct(_daily_metric(cur_d, 'hrv_rmssd'), _daily_metric(prev_d, 'hrv_rmssd'))
    rhr_pct = _pct(_daily_metric(cur_d, 'resting_hr'), _daily_metric(prev_d, 'resting_hr'))
    recovery_parts = [x for x in (hrv_pct, sleep_pct, -rhr_pct if rhr_pct is not None else None) if x is not None]
    recovery_pct = sum(recovery_parts) / len(recovery_parts) if recovery_parts else None
    strength_pct = _strength_progress(cur_s, prev_s, exmap)

    current_sessions = len({x.get('session_id') for x in cur_s if x.get('session_id')})
    target = max(1, round(_routine_days_per_week() * days / 7.0))
    consistency = min(100.0, current_sessions * 100.0 / target)
    weight_cur = _daily_metric(cur_d, 'weight_kg', 'latest')
    weight_prev = _daily_metric(prev_d, 'weight_kg', 'latest')
    weight_delta = (weight_cur - weight_prev) if weight_cur is not None and weight_prev is not None else None

    positives = []
    cautions = []
    if activity_pct is not None:
        (positives if activity_pct > 3 else cautions if activity_pct < -3 else positives).append(f'actividad {"subió" if activity_pct > 3 else "bajó" if activity_pct < -3 else "se mantuvo"}')
    if strength_pct is not None:
        (positives if strength_pct > 2 else cautions if strength_pct < -2 else positives).append(f'fuerza {"mejoró" if strength_pct > 2 else "retrocedió" if strength_pct < -2 else "se mantuvo"}')
    if recovery_pct is not None:
        (positives if recovery_pct > 2 else cautions if recovery_pct < -2 else positives).append(f'recuperación {"mejoró" if recovery_pct > 2 else "empeoró" if recovery_pct < -2 else "se mantuvo"}')
    conclusion = 'Todavía no hay suficientes datos para comparar este período.'
    if positives or cautions:
        conclusion = 'En el período seleccionado, ' + ', '.join(positives + cautions) + '.'

    return {
        'period': period, 'days': days,
        'metrics': {
            'activity_pct': activity_pct, 'strength_pct': strength_pct, 'recovery_pct': recovery_pct,
            'sleep_pct': sleep_pct, 'steps_pct': steps_pct, 'weight_delta_kg': weight_delta,
            'consistency_pct': consistency, 'sport_minutes': _activity_minutes(cur_a),
        },
        'daily': cur_d,
        'previous_daily': prev_d,
        'conclusion': conclusion,
    }


def _strength_payload(period):
    days = _period_days(period)
    s1, e1 = _range(days)
    s0, e0 = _range(days, days)
    exmap = _exercise_map()
    history = _strength_history()
    cur, prev = _filter_dates(history, 'performed_at', s1, e1), _filter_dates(history, 'performed_at', s0, e0)
    exercise_stats = _strength_metrics(cur, exmap)
    prev_stats = {x['exercise_id']: x for x in _strength_metrics(prev, exmap)}
    for x in exercise_stats:
        p = prev_stats.get(x['exercise_id'])
        x['e1rm_change_pct'] = _pct(x['best_e1rm'], p.get('best_e1rm') if p else None)

    muscles = defaultdict(lambda: {'sets': 0, 'reps': 0, 'volume': 0.0})
    for x in exercise_stats:
        m = x.get('muscle') or 'Sin clasificar'
        muscles[m]['sets'] += x['sets']
        muscles[m]['reps'] += x['reps']
        muscles[m]['volume'] += x['volume']

    sessions = _safe_select('workout_sessions', f'select=id,date,title,status,source,created_at&date=gte.{s1.isoformat()}&date=lte.{e1.isoformat()}&order=date.desc,created_at.desc&limit=300')
    by_session = defaultdict(lambda: {'sets': 0, 'reps': 0, 'volume': 0.0})
    for r in cur:
        sid = r.get('session_id')
        if sid:
            by_session[sid]['sets'] += 1
            reps = _num(r.get('reps')) or 0
            weight = _num(r.get('weight_kg')) or 0
            by_session[sid]['reps'] += reps
            by_session[sid]['volume'] += weight * reps
    session_rows = []
    for s in sessions:
        metric = by_session.get(s.get('id'), {})
        session_rows.append({'kind': 'manual', **s, **metric})

    imports = _safe_select('garmin_strength_imports', f'select=id,date,title,duration_s,calories,hr_avg,hr_max,created_at&date=gte.{s1.isoformat()}&date=lte.{e1.isoformat()}&order=date.desc,created_at.desc&limit=300')
    for g in imports:
        session_rows.append({'kind': 'garmin', **g})
    session_rows.sort(key=lambda x: (str(x.get('date') or ''), str(x.get('created_at') or '')), reverse=True)

    return {
        'period': period,
        'metrics': {
            'sessions': len({x.get('session_id') for x in cur if x.get('session_id')}) or len(sessions),
            'sets': len(cur),
            'reps': sum((_num(x.get('reps')) or 0) for x in cur),
            'volume': sum((_num(x.get('weight_kg')) or 0) * (_num(x.get('reps')) or 0) for x in cur),
            'progress_pct': _strength_progress(cur, prev, exmap),
            'volume_change_pct': _pct(sum(x['volume'] for x in exercise_stats), sum(x['volume'] for x in prev_stats.values())),
        },
        'exercise_stats': exercise_stats,
        'muscles': [{'muscle': k, **v} for k, v in muscles.items()],
        'sessions': session_rows,
        'history': [{
            'date': str(r.get('performed_at') or '')[:10],
            'exercise_id': r.get('exercise_id'),
            'exercise': exmap.get(r.get('exercise_id'), {}).get('name') or r.get('exercise_name') or 'Ejercicio',
            'muscle': exmap.get(r.get('exercise_id'), {}).get('primary_muscle') or 'Sin clasificar',
            'weight_kg': _num(r.get('weight_kg')), 'reps': _num(r.get('reps')),
            'e1rm': ((_num(r.get('weight_kg')) or 0) * (1 + (_num(r.get('reps')) or 0) / 30.0)) if _num(r.get('weight_kg')) and _num(r.get('reps')) else None,
        } for r in cur],
    }


def _manual_session_detail(sid):
    sessions = _safe_select('workout_sessions', f'select=*&id=eq.{sid}&limit=1')
    if not sessions:
        return None
    session = sessions[0]
    sets = _safe_select('workout_sets', f'select=*&session_id=eq.{sid}&order=set_number.asc&limit=500')
    exmap = _exercise_map()
    grouped = defaultdict(list)
    muscles = defaultdict(lambda: {'sets': 0, 'reps': 0, 'volume': 0.0})
    for s in sets:
        grouped[s.get('exercise_id')].append(s)
        ex = exmap.get(s.get('exercise_id'), {})
        m = ex.get('primary_muscle') or 'Sin clasificar'
        reps = _num(s.get('reps')) or 0
        weight = _num(s.get('weight_kg')) or 0
        muscles[m]['sets'] += 1
        muscles[m]['reps'] += reps
        muscles[m]['volume'] += weight * reps
    exercises = []
    for eid, rows in grouped.items():
        ex = exmap.get(eid, {})
        volume = sum((_num(x.get('weight_kg')) or 0) * (_num(x.get('reps')) or 0) for x in rows)
        best = max(rows, key=lambda x: ((_num(x.get('weight_kg')) or 0) * (1 + (_num(x.get('reps')) or 0) / 30.0)), default={})
        exercises.append({
            'exercise_id': eid, 'name': ex.get('name') or 'Ejercicio', 'muscle': ex.get('primary_muscle') or 'Sin clasificar',
            'sets': rows, 'set_count': len(rows), 'volume': volume,
            'best_set': {'weight_kg': best.get('weight_kg'), 'reps': best.get('reps')} if best else None,
        })
    fit = _safe_select('garmin_strength_imports', f"select=*&date=eq.{session.get('date')}&order=created_at.desc&limit=1")
    fit = fit[0] if fit else {}
    return {
        'kind': 'manual', 'session': session, 'exercises': exercises,
        'metrics': {
            'sets': len(sets), 'reps': sum((_num(x.get('reps')) or 0) for x in sets),
            'volume': sum((_num(x.get('weight_kg')) or 0) * (_num(x.get('reps')) or 0) for x in sets),
            'duration_s': fit.get('duration_s'), 'calories': fit.get('calories'), 'hr_avg': fit.get('hr_avg'), 'hr_max': fit.get('hr_max'),
        },
        'muscles': [{'muscle': k, **v} for k, v in muscles.items()],
    }


def _garmin_session_detail(sid):
    imports = _safe_select('garmin_strength_imports', f'select=*&id=eq.{sid}&limit=1')
    if not imports:
        return None
    imp = imports[0]
    rows = _safe_select('garmin_strength_sets', f'select=*&import_id=eq.{sid}&order=set_number.asc&limit=500')
    exercises = defaultdict(list)
    muscles = defaultdict(lambda: {'sets': 0, 'reps': 0, 'volume': 0.0})
    for r in rows:
        if str(r.get('set_type') or '').lower() in ('recovery', 'descanso'):
            continue
        name = r.get('exercise_name_garmin') or r.get('exercise_category') or 'Ejercicio'
        exercises[name].append(r)
        reps = _num(r.get('reps')) or 0
        weight = _num(r.get('weight_kg')) or 0
        ms = r.get('muscles') or r.get('primary_muscles') or []
        if isinstance(ms, str):
            ms = [ms]
        if not ms:
            ms = ['Sin clasificar']
        for m in ms:
            muscles[str(m)]['sets'] += 1
            muscles[str(m)]['reps'] += reps
            muscles[str(m)]['volume'] += weight * reps
    exrows = []
    for name, sets in exercises.items():
        exrows.append({'name': name, 'sets': sets, 'set_count': len(sets), 'volume': sum((_num(x.get('weight_kg')) or 0) * (_num(x.get('reps')) or 0) for x in sets)})
    return {
        'kind': 'garmin', 'session': imp, 'exercises': exrows,
        'metrics': {'sets': sum(x['set_count'] for x in exrows), 'reps': sum((_num(x.get('reps')) or 0) for x in rows), 'volume': sum(x['volume'] for x in exrows), 'duration_s': imp.get('duration_s'), 'calories': imp.get('calories'), 'hr_avg': imp.get('hr_avg'), 'hr_max': imp.get('hr_max')},
        'muscles': [{'muscle': k, **v} for k, v in muscles.items()],
    }


DASHBOARD_HTML = """<!doctype html>
<html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Dashboard Salud</title><link rel='stylesheet' href='/static/dashboard.css?v=1'>
<script src='https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js'></script></head>
<body><div id='dashboardApp' class='app-shell'>
<aside class='sidebar' id='sidebar'>
  <div class='brand'><div class='brand-mark'>DS</div><div class='brand-text'><b>Dashboard Salud</b><small>Salud y rendimiento</small></div><button id='collapseSidebar' class='icon-btn'>‹</button></div>
  <nav class='nav'>
    <div class='nav-group open'><button class='nav-parent' data-toggle='summary'><span>▦</span><b>Resumen</b><i>⌄</i></button><div class='nav-children' id='group-summary'><button class='nav-link active' data-page='summary'>Principal</button><button class='nav-link' data-page='global'>Evolución global</button></div></div>
    <button class='nav-link nav-main' data-page='health'><span>♥</span><b>Salud</b></button>
    <div class='nav-group'><button class='nav-parent' data-toggle='strength'><span>◆</span><b>Fuerza</b><i>⌄</i></button><div class='nav-children' id='group-strength'><button class='nav-link' data-page='strength'>Resumen y evolución</button><button class='nav-link' data-page='strength-sessions'>Sesiones</button></div></div>
    <button class='nav-link nav-main' data-page='sports'><span>◉</span><b>Deportes</b></button>
    <button class='nav-link nav-main' data-page='sleep'><span>☾</span><b>Sueño</b></button>
    <button class='nav-link nav-main' data-page='steps'><span>↗</span><b>Pasos</b></button>
    <a class='nav-link nav-main' href='/gym'><span>＋</span><b>Registro de fuerza</b></a>
    <button class='nav-link nav-main' data-page='sync'><span>↻</span><b>Sincronización</b></button>
    <button class='nav-link nav-main' data-page='settings'><span>⚙</span><b>Configuración</b></button>
  </nav>
</aside>
<div class='main-wrap'>
<header class='topbar'><div class='top-left'><button id='mobileMenu' class='icon-btn menu-btn'>☰</button><h1 id='pageTitle'>Resumen</h1></div><div class='top-actions'>
  <div class='status-chip' id='tredictChip'><span class='dot'></span><span>Tredict</span><small>comprobando</small></div>
  <div class='status-chip' id='garminChip'><span class='dot'></span><span>Garmin</span><small>sin datos</small></div>
  <div class='sync-time' id='syncTime'>Última sincronización: —</div>
  <button id='refreshAll' class='action-btn'>↻ Sincronizar</button>
  <div class='view-toggle'><button id='pcMode' class='on' title='Vista PC'>▰</button><button id='mobileMode' title='Vista móvil'>▯</button></div>
</div></header>
<main class='content'>
<section class='page active' id='page-summary' data-title='Resumen'></section>
<section class='page' id='page-global' data-title='Evolución global'></section>
<section class='page' id='page-health' data-title='Salud'></section>
<section class='page' id='page-strength' data-title='Fuerza'></section>
<section class='page' id='page-strength-sessions' data-title='Sesiones de fuerza'></section>
<section class='page' id='page-sports' data-title='Deportes'></section>
<section class='page' id='page-sleep' data-title='Sueño'></section>
<section class='page' id='page-steps' data-title='Pasos'></section>
<section class='page' id='page-sync' data-title='Sincronización'></section>
<section class='page' id='page-settings' data-title='Configuración'></section>
</main></div></div>
<div id='drawerBackdrop' class='drawer-backdrop'></div><div id='toast' class='toast'></div>
<script src='/static/dashboard.js?v=1'></script></body></html>"""


def dashboard_home():
    return DASHBOARD_HTML


@app.get('/api/dashboard/overview')
@app_core.auth
def dashboard_overview():
    return jsonify(_overview_payload())


@app.get('/api/dashboard/global')
@app_core.auth
def dashboard_global():
    return jsonify(_global_payload(request.args.get('period', 'month')))


@app.get('/api/dashboard/health')
@app_core.auth
def dashboard_health():
    period = request.args.get('period', 'month')
    days = _period_days(period)
    start, end = _range(days)
    rows = _filter_dates(_daily_all(), 'date', start, end)
    return jsonify({'period': period, 'rows': rows})


@app.get('/api/dashboard/strength')
@app_core.auth
def dashboard_strength():
    return jsonify(_strength_payload(request.args.get('period', 'month')))


@app.get('/api/dashboard/strength/session/<kind>/<sid>')
@app_core.auth
def dashboard_strength_session(kind, sid):
    data = _garmin_session_detail(sid) if kind == 'garmin' else _manual_session_detail(sid)
    if not data:
        return jsonify({'error': 'No se encontró el entrenamiento'}), 404
    return jsonify(data)


@app.get('/api/dashboard/sports')
@app_core.auth
def dashboard_sports():
    period = request.args.get('period', 'month')
    days = _period_days(period)
    start, end = _range(days)
    rows = [x for x in _filter_dates(_tredict_activities(), 'date', start, end) if x.get('kind') != 'strength']
    return jsonify({'period': period, 'rows': rows})


@app.get('/api/dashboard/sleep')
@app_core.auth
def dashboard_sleep():
    period = request.args.get('period', 'month')
    days = _period_days(period)
    start, end = _range(days)
    rows = _filter_dates(_daily_all(), 'date', start, end)
    return jsonify({'period': period, 'rows': rows})


@app.get('/api/dashboard/steps')
@app_core.auth
def dashboard_steps():
    period = request.args.get('period', 'month')
    days = _period_days(period)
    start, end = _range(days)
    rows = _filter_dates(_daily_all(), 'date', start, end)
    return jsonify({'period': period, 'rows': rows})


@app.get('/api/dashboard/sync')
@app_core.auth
def dashboard_sync():
    fit = _safe_select('garmin_fit_files', 'select=folder_date,uploaded_at,status&order=uploaded_at.desc&limit=5000')
    dates = sorted({str(x.get('folder_date')) for x in fit if x.get('folder_date')})
    tredict = tredict_sync._probe_tredict()
    return jsonify({
        'tredict': tredict,
        'garmin': {'files': len(fit), 'days': len(dates), 'first_date': dates[0] if dates else None, 'last_date': dates[-1] if dates else None, 'latest_upload': fit[0].get('uploaded_at') if fit else None},
    })


# Reemplaza únicamente la pantalla de inicio existente. Login, carga FIT y gym continúan usando sus rutas actuales.
app.view_functions['home'] = app_core.auth(dashboard_home)
