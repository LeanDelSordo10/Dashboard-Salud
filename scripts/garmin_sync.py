"""Sincroniza Garmin Connect (Personal API) con el dashboard.

Lo corre GitHub Actions cada 3 horas (.github/workflows/garmin-sync.yml):
1. Canjea la llave personal (secreto GARMIN_PERSONAL_API_KEY) por un permiso de 24 h.
2. Lee, por día: pasos y distancia, calorías activas, pulso en reposo, minutos de
   intensidad, horas de sueño y HRV. Y los entrenamientos de fuerza (solo resumen:
   duración, calorías y pulso; las series siguen siendo las que se cargan en la app).
3. Los envía a la API del dashboard, identificándose con el token OIDC de GitHub
   (no hay ningún secreto compartido con Supabase).

Como el repositorio es público, el registro SOLO muestra cantidades, nunca datos.
"""
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

GARMIN = 'https://personal.connectapi.garmin.com'
TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token'
INGEST_URL = 'https://yqqpdmqykcdwqovbnato.supabase.co/functions/v1/api/garmin/ingest'
AUDIENCE = 'dashboard-salud-garmin'
TZ = ZoneInfo('America/Argentina/Buenos_Aires')
TIMEOUT = 40
CHUNK_DAYS = 14


class SyncError(Exception):
    pass


def github_oidc_token() -> str:
    url, bearer = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL'), os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    if not url or not bearer:
        sys.exit('Falta el permiso id-token del workflow.')
    r = requests.get(f'{url}&audience={AUDIENCE}', headers={'Authorization': f'Bearer {bearer}'}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()['value']


def send(payload: dict) -> dict:
    r = requests.post(INGEST_URL, json=payload, timeout=60,
                      headers={'Authorization': f'Bearer {github_oidc_token()}'})
    if not r.ok:
        sys.exit(f'La API del dashboard respondió HTTP {r.status_code}.')
    return r.json()


def garmin_session(key: str) -> requests.Session:
    r = requests.post(GARMIN + TOKEN_PATH, headers={'Accept': '*/*', 'Authorization': f'ApiKey {key}'}, timeout=TIMEOUT)
    if r.status_code in (401, 403):
        raise SyncError('Garmin rechazó la llave personal: puede estar vencida. Creá una nueva y reemplazá el secreto GARMIN_PERSONAL_API_KEY.')
    if not r.ok:
        raise SyncError(f'Garmin no entregó el permiso de acceso (HTTP {r.status_code}).')
    s = requests.Session()
    s.headers.update({'Authorization': 'Bearer ' + r.text.strip(), 'Accept': 'application/json'})
    return s


def get(s: requests.Session, path: str, params=None):
    r = s.get(GARMIN + path, params=params, timeout=TIMEOUT)
    if r.status_code == 404:
        return None
    if not r.ok:
        raise SyncError(f'Garmin respondió HTTP {r.status_code} al leer datos.')
    return r.json() if r.content else None


def g(obj, *keys):
    """Lee obj[k1][k2]... devolviendo None si algo falta."""
    for k in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    return obj


def collect(s: requests.Session, start: date, end: date):
    days: dict[str, dict] = {}
    day = lambda d: days.setdefault(d, {'date': d})  # noqa: E731

    a = start
    while a <= end:
        b = min(end, a + timedelta(days=CHUNK_DAYS - 1))
        A, B = a.isoformat(), b.isoformat()
        for it in get(s, f'/usersummary-service/stats/steps/daily/{A}/{B}') or []:
            if it.get('calendarDate'):
                day(it['calendarDate']).update(steps=it.get('totalSteps'), distance_m=it.get('totalDistance'))
        for it in g(get(s, '/usersummary-service/v2/dailysummaries', {'startDate': A, 'endDate': B}), 'data') or []:
            d = it.get('calendarDate')
            if not d:
                continue
            mod, vig = g(it, 'intensityMinutes', 'moderate'), g(it, 'intensityMinutes', 'vigorous')
            day(d).update(
                active_calories=g(it, 'calories', 'burnedActive'),
                resting_hr=g(it, 'heartRate', 'restingValue'),
                active_seconds=((mod or 0) + (vig or 0)) * 60 if (mod is not None or vig is not None) else None,
            )
        for it in get(s, '/sleep-service/sleep/dailySleepSummariesByDate', {'startDate': A, 'endDate': B}) or []:
            if it.get('calendarDate') and it.get('sleepTimeSeconds'):
                day(it['calendarDate'])['sleep_seconds'] = it['sleepTimeSeconds']
        for it in g(get(s, f'/hrv-service/hrv/daily/{A}/{B}'), 'hrvSummaries') or []:
            if it.get('calendarDate') and it.get('lastNightAvg'):
                day(it['calendarDate'])['hrv_rmssd'] = it['lastNightAvg']
        a = b + timedelta(days=1)

    strength, page = [], 0
    while True:
        acts = get(s, '/activitylist-service/activities/search/activities',
                   {'start': page * 100, 'limit': 100, 'startDate': start.isoformat(), 'endDate': end.isoformat()}) or []
        for act in acts:
            if 'strength' not in str(g(act, 'activityType', 'typeKey') or ''):
                continue
            when = str(act.get('startTimeLocal') or '')[:10]
            strength.append({
                'activity_id': act.get('activityId'), 'date': when,
                'duration_s': act.get('duration'), 'calories': act.get('calories'),
                'hr_avg': act.get('averageHR'), 'hr_max': act.get('maxHR'),
            })
        if len(acts) < 100:
            break
        page += 1

    keep = [v for k, v in days.items() if start.isoformat() <= k <= end.isoformat()]
    return sorted(keep, key=lambda x: x['date']), strength


def main():
    key = os.environ.get('GARMIN_PERSONAL_API_KEY', '').strip()
    today = datetime.now(TZ).date()
    since = (os.environ.get('SYNC_SINCE') or '').strip()
    try:
        start = date.fromisoformat(since) if since else today - timedelta(days=3)
    except ValueError:
        sys.exit('La fecha "desde" debe tener el formato AAAA-MM-DD.')
    start = max(start, today - timedelta(days=400))
    try:
        if not key:
            raise SyncError('Falta el secreto GARMIN_PERSONAL_API_KEY en GitHub.')
        s = garmin_session(key)
        days, strength = collect(s, start, today)
    except (SyncError, requests.RequestException) as e:
        msg = str(e) if isinstance(e, SyncError) else f'Error de conexión con Garmin ({type(e).__name__}).'
        send({'error': msg})
        sys.exit(msg)
    r = send({'range': {'start': start.isoformat(), 'end': today.isoformat()}, 'days': days, 'strength': strength})
    print(f'Rango {start} → {today}: {r.get("days")} días guardados; '
          f'{r.get("strength_received")} entrenamientos de fuerza en Garmin, {r.get("sessions_linked")} unidos a tus registros.')


if __name__ == '__main__':
    main()
