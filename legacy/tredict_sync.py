import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests
from flask import jsonify

import app_core
from fit_folder import app

TREDICT_TOKEN = os.getenv('TREDICT_TOKEN', '').strip()
TREDICT_BASE = 'https://www.tredict.com/api/oauth/v2'
TREDICT_ACTIVITY_LIST = f'{TREDICT_BASE}/activityList'
TREDICT_BODYVALUES = f'{TREDICT_BASE}/bodyvalues'
TREDICT_HRV = f'{TREDICT_BASE}/hrv'
TREDICT_SLEEP = f'{TREDICT_BASE}/sleep'


def _tredict_headers():
    return {
        'Authorization': f'Bearer {TREDICT_TOKEN}',
        'Accept': 'application/json;charset=UTF-8',
        'Content-Type': 'application/json',
    }


def _get(url, params=None, timeout=25):
    if not TREDICT_TOKEN:
        raise RuntimeError('TREDICT_TOKEN no está configurado')
    r = requests.get(url, params=params, headers=_tredict_headers(), timeout=timeout)
    if r.status_code in (401, 403):
        raise RuntimeError('Token rechazado por Tredict o sin permisos suficientes')
    r.raise_for_status()
    return r.json() if r.content else {}


def _supabase_upsert(table, rows, conflict):
    if not rows:
        return
    url = f'{app_core.SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}'
    headers = app_core.headers({'Prefer': 'resolution=merge-duplicates,return=minimal'})
    r = requests.post(url, headers=headers, json=rows, timeout=30)
    r.raise_for_status()


def _safe_int(value):
    try:
        return int(round(float(value))) if value is not None else None
    except Exception:
        return None


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _local_date_from_activity(value, tz_name=None):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if tz_name:
            try:
                dt = dt.astimezone(ZoneInfo(tz_name))
            except Exception:
                pass
        return dt.date().isoformat()
    except Exception:
        return str(value)[:10]


def _local_date_from_revision(timestamp, offset_seconds=0):
    if not timestamp:
        return None
    try:
        dt = datetime.fromisoformat(str(timestamp).replace('Z', '+00:00'))
        dt = dt + timedelta(seconds=int(offset_seconds or 0))
        return dt.date().isoformat()
    except Exception:
        return str(timestamp)[:10]


def _activity_rows():
    rows = []
    next_url = TREDICT_ACTIVITY_LIST
    params = {'pageSize': 1000, 'extendedSummary': 1}
    pages = 0
    while next_url and pages < 10:
        data = _get(next_url, params=params if pages == 0 else None)
        raw = data.get('activities') or data.get('activityList') or data.get('trainings') or []
        if not isinstance(raw, list):
            raw = []
        for a in raw:
            summary = a.get('summary') or a.get('extendedSummary') or {}
            activity_date = a.get('date') or a.get('startTime') or a.get('start') or a.get('dateStart')
            tz_name = a.get('timezone') or summary.get('timezone')
            duration_total = summary.get('durationTotal')
            if duration_total is None:
                duration_total = a.get('durationTotal') or a.get('durationSeconds')
            duration_active = summary.get('duration')
            if duration_active is None:
                duration_active = a.get('duration') or a.get('activeDuration')
            calories = summary.get('calories') if summary.get('calories') is not None else a.get('calories')
            hr_avg = summary.get('heartrate')
            if hr_avg is None:
                hr_avg = summary.get('heartrateAvg') or a.get('heartrateAvg') or a.get('heartRateAvg') or a.get('hrAvg')
            hr_max = summary.get('heartrateMax')
            if hr_max is None:
                hr_max = a.get('heartrateMax') or a.get('heartRateMax') or a.get('hrMax')
            effort = summary.get('effort') if summary.get('effort') is not None else a.get('effort') or a.get('trainingEffort')
            distance = summary.get('distance') if summary.get('distance') is not None else a.get('distance')
            aid = a.get('id') or a.get('activityId')
            if not aid:
                continue
            rows.append({
                'id': str(aid),
                'activity_date': activity_date,
                'local_date': _local_date_from_activity(activity_date, tz_name),
                'sport_type': a.get('sportType') or a.get('sport') or a.get('activityType') or a.get('type'),
                'sub_sport_type': a.get('subSportType') or a.get('subSport') or a.get('misc'),
                'title': a.get('title') or a.get('name'),
                'duration_total_s': _safe_float(duration_total),
                'duration_active_s': _safe_float(duration_active),
                'calories': _safe_int(calories),
                'hr_avg': _safe_int(hr_avg),
                'hr_max': _safe_int(hr_max),
                'effort': _safe_float(effort),
                'distance_m': _safe_float(distance),
                'timezone': tz_name,
                'raw_json': a,
                'updated_at': datetime.now(timezone.utc).isoformat(),
            })
        links = data.get('_links') or {}
        nxt = links.get('next')
        if isinstance(nxt, dict):
            nxt = nxt.get('href')
        if nxt and urlparse(nxt).netloc.endswith('tredict.com'):
            next_url = nxt
        else:
            next_url = None
        pages += 1
    return rows


def _daily_from_tredict():
    existing = app_core.select('daily_health', 'select=*&order=date.asc&limit=5000')
    daily = {str(r.get('date')): dict(r) for r in existing if r.get('date')}

    def row_for(day):
        row = daily.get(day)
        if row is None:
            row = {
                'date': day,
                'steps': None,
                'distance_m': None,
                'active_seconds': None,
                'active_calories': None,
                'sleep_seconds': None,
                'hrv_rmssd': None,
                'resting_hr': None,
                'weight_kg': None,
                'skin_temp_c': None,
                'source_fit': False,
                'source_tredict': True,
            }
            daily[day] = row
        row['source_tredict'] = True
        row['updated_at'] = datetime.now(timezone.utc).isoformat()
        return row

    body = _get(TREDICT_BODYVALUES)
    for item in body.get('bodyvalues') or []:
        day = _local_date_from_revision(item.get('timestamp'), item.get('timezoneOffsetInSeconds') or 0)
        if not day:
            continue
        row = row_for(day)
        if item.get('restingHeartrate') is not None:
            row['resting_hr'] = _safe_int(item.get('restingHeartrate'))
        elif item.get('hrRestDynamic') is not None:
            row['resting_hr'] = _safe_int(item.get('hrRestDynamic'))
        if item.get('weightInKilograms') is not None:
            row['weight_kg'] = _safe_float(item.get('weightInKilograms'))

    now = datetime.now(timezone.utc)
    oldest = now - timedelta(days=365)
    params = {'startDate': now.isoformat().replace('+00:00', 'Z'), 'endDate': oldest.isoformat().replace('+00:00', 'Z')}

    hrv = _get(TREDICT_HRV, params=params)
    for key, value in (hrv.get('hrv') or {}).items():
        if not key or not isinstance(value, (list, tuple)) or not value:
            continue
        day = f'{key[:4]}-{key[4:6]}-{key[6:8]}'
        row_for(day)['hrv_rmssd'] = _safe_float(value[0])

    sleep = _get(TREDICT_SLEEP, params=params)
    for key, value in (sleep.get('sleep') or {}).items():
        if not key or not isinstance(value, (list, tuple)) or not value:
            continue
        day = f'{key[:4]}-{key[4:6]}-{key[6:8]}'
        row_for(day)['sleep_seconds'] = _safe_int(value[0])

    touched = [r for r in daily.values() if r.get('source_tredict')]
    # Eliminar columnas que no pertenecen a daily_health si Supabase devolviera extras en el futuro.
    allowed = {'date','steps','distance_m','active_seconds','active_calories','sleep_seconds','hrv_rmssd','resting_hr','weight_kg','skin_temp_c','source_fit','source_tredict','updated_at'}
    return [{k: v for k, v in r.items() if k in allowed} for r in touched]


def sync_tredict_to_supabase():
    activities = _activity_rows()
    _supabase_upsert('tredict_activities', activities, 'id')
    daily_rows = _daily_from_tredict()
    _supabase_upsert('daily_health', daily_rows, 'date')
    detail = {
        'activities': len(activities),
        'daily_rows': len(daily_rows),
        'completed_at': datetime.now(timezone.utc).isoformat(),
    }
    app_core.insert('tredict_sync_log', [{
        'activities_count': len(activities),
        'daily_rows_count': len(daily_rows),
        'status': 'ok',
        'detail': detail,
    }], returning=False)
    return detail


def _probe_tredict():
    if not TREDICT_TOKEN:
        return {'connected': False, 'error': 'TREDICT_TOKEN no está configurado'}
    try:
        data = _get(TREDICT_ACTIVITY_LIST, {'pageSize': 50, 'extendedSummary': 1}, timeout=15)
        activities = data.get('activities') or data.get('activityList') or data.get('trainings') or []
        result = {'connected': True, 'status': 200, 'activities_returned': len(activities) if isinstance(activities, list) else None}
        try:
            logs = app_core.select('tredict_sync_log', 'select=synced_at,activities_count,daily_rows_count,status&order=synced_at.desc&limit=1')
            if logs:
                result['last_sync'] = logs[0]
        except Exception:
            pass
        return result
    except Exception as exc:
        return {'connected': False, 'error': str(exc)}


def tredict_status():
    return jsonify(_probe_tredict())


def tredict_sync():
    try:
        return jsonify({'ok': True, **sync_tredict_to_supabase()})
    except Exception as exc:
        try:
            app_core.insert('tredict_sync_log', [{
                'activities_count': 0,
                'daily_rows_count': 0,
                'status': 'error',
                'detail': {'error': str(exc)},
            }], returning=False)
        except Exception:
            pass
        return jsonify({'ok': False, 'error': str(exc)}), 500


app.add_url_rule('/api/tredict/status', 'tredict_status', app_core.auth(tredict_status), methods=['GET'])
app.add_url_rule('/api/tredict/sync', 'tredict_sync', app_core.auth(tredict_sync), methods=['POST'])
