"""Prueba de lectura de la Garmin Personal API (no guarda nada).

Se corre a mano desde GitHub Actions ("Garmin: prueba de lectura").
Como el repositorio es público, el registro SOLO muestra estructura:
códigos de respuesta, cantidad de elementos y nombres de campos. Nunca valores.
"""
import os
import sys
from datetime import date, timedelta

import requests

BASE = 'https://personal.connectapi.garmin.com'
TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token'
TIMEOUT = 30


def token(key: str) -> str:
    r = requests.post(BASE + TOKEN_PATH, headers={'Accept': '*/*', 'Authorization': f'ApiKey {key}'}, timeout=TIMEOUT)
    print(f'token: HTTP {r.status_code}')
    if not r.ok:
        sys.exit('No se pudo obtener el permiso de acceso (revisá que la llave sea correcta y no esté vencida).')
    return r.text.strip()


def shape(v, depth=0):
    """Describe la forma del JSON sin mostrar valores."""
    if isinstance(v, list):
        inner = shape(v[0], depth + 1) if v else '-'
        return f'lista[{len(v)}] de {inner}'
    if isinstance(v, dict):
        if depth >= 3:
            return f'objeto({len(v)} campos)'
        parts = []
        for k in sorted(v)[:40]:
            x = v[k]
            if isinstance(x, (dict, list)):
                parts.append(f'{k}: {shape(x, depth + 1)}')
            else:
                parts.append(f'{k}{"" if x is not None else "∅"}')
        return '{' + ', '.join(parts) + (', …' if len(v) > 40 else '') + '}'
    return type(v).__name__


def main():
    key = os.environ.get('GARMIN_PERSONAL_API_KEY', '').strip()
    if not key:
        sys.exit('Falta el secreto GARMIN_PERSONAL_API_KEY en GitHub.')
    s = requests.Session()
    s.headers['Authorization'] = 'Bearer ' + token(key)

    today = date.today()
    recent = (today - timedelta(days=3), today)
    old = (date(2026, 10, 1), date(2026, 10, 7))  # para saber si se puede completar el hueco de octubre

    def get(label, path, params=None, raw=False):
        try:
            r = s.get(BASE + path, params=params, timeout=TIMEOUT,
                      headers={'Accept': 'application/zip, application/x-zip-compressed, application/octet-stream' if raw else 'application/json'})
        except requests.RequestException as e:
            print(f'\n[{label}] error de red: {type(e).__name__}')
            return None
        print(f'\n[{label}] HTTP {r.status_code}')
        if not r.ok:
            return None
        if raw:
            print(f'  archivo de {len(r.content)} bytes')
            return r.content
        data = r.json() if r.content else None
        print('  ' + shape(data))
        return data

    for name, (a, b) in (('recientes', recent), ('octubre', old)):
        get(f'resúmenes diarios ({name})', '/usersummary-service/v2/dailysummaries', {'startDate': a.isoformat(), 'endDate': b.isoformat()})
        get(f'pasos ({name})', f'/usersummary-service/stats/steps/daily/{a}/{b}')
        get(f'sueño ({name})', '/sleep-service/sleep/dailySleepSummariesByDate', {'startDate': a.isoformat(), 'endDate': b.isoformat()})
        get(f'HRV ({name})', f'/hrv-service/hrv/daily/{a}/{b}')

    acts = get('actividades (desde 1/10)', '/activitylist-service/activities/search/activities',
               {'start': 0, 'limit': 50, 'startDate': '2026-10-01', 'endDate': today.isoformat()})
    if isinstance(acts, list):
        types = {}
        for a in acts:
            t = (a.get('activityType') or {}).get('typeKey', '?') if isinstance(a, dict) else '?'
            types[t] = types.get(t, 0) + 1
        print('  tipos de actividad:', ', '.join(f'{k}×{v}' for k, v in sorted(types.items())))
        strength = [a for a in acts if isinstance(a, dict) and 'strength' in str((a.get('activityType') or {}).get('typeKey', ''))]
        if strength:
            aid = strength[0].get('activityId')
            get('detalle de una actividad de fuerza', f'/activity-service/activity/{aid}')
            get('archivo original de esa actividad', f'/download-service/files/activity/{aid}', raw=True)


if __name__ == '__main__':
    main()
