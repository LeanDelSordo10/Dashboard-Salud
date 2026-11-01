import io
from datetime import datetime, timezone
import requests
from fitparse import FitFile
from flask import jsonify, request

import app_core
from fit_folder import app
import garmin_parser


def _safe(v):
    try:
        if hasattr(v, 'isoformat'):
            return v.isoformat()
        if isinstance(v, (str, int, float, bool)) or v is None:
            return v
        return str(v)
    except Exception:
        return None


def _field(msg, name):
    try:
        return _safe(msg.get_value(name))
    except Exception:
        return None


def _diagnose_day(day):
    rows = app_core.select(
        'garmin_fit_files',
        f"select=filename,storage_path,folder_date,status&folder_date=gte.{day}&folder_date=lte.{day}&order=filename.asc&limit=200"
    )
    try:
        from datetime import date, timedelta
        nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
        rows += app_core.select(
            'garmin_fit_files',
            f"select=filename,storage_path,folder_date,status&folder_date=eq.{nxt}&order=filename.asc&limit=200"
        )
    except Exception:
        pass

    result = []
    for row in rows:
        if '_WELLNESS.fit' not in (row.get('filename') or '') and '_ACTIVITY.fit' not in (row.get('filename') or ''):
            continue
        item = {
            'filename': row.get('filename'),
            'folder_date': row.get('folder_date'),
            'status': row.get('status'),
            'monitoring': [],
            'session': []
        }
        try:
            data = garmin_parser._download_fit(row['storage_path'])
            fit = FitFile(io.BytesIO(data))
            for msg in fit.get_messages():
                if msg.name == 'monitoring':
                    rec = {
                        'timestamp': _field(msg, 'timestamp'),
                        'local_timestamp': _field(msg, 'local_timestamp'),
                        'timestamp_16': _field(msg, 'timestamp_16'),
                        'activity_type': _field(msg, 'activity_type'),
                        'current_activity_type_intensity': _field(msg, 'current_activity_type_intensity'),
                        'steps': _field(msg, 'steps'),
                        'cycles': _field(msg, 'cycles'),
                        'cycles_16': _field(msg, 'cycles_16'),
                        'distance': _field(msg, 'distance'),
                        'distance_16': _field(msg, 'distance_16'),
                        'active_time': _field(msg, 'active_time'),
                        'active_time_16': _field(msg, 'active_time_16'),
                        'active_calories': _field(msg, 'active_calories'),
                    }
                    if any(v is not None for v in rec.values()):
                        item['monitoring'].append(rec)
                elif msg.name == 'session':
                    item['session'].append({
                        'timestamp': _field(msg, 'timestamp'),
                        'start_time': _field(msg, 'start_time'),
                        'sport': _field(msg, 'sport'),
                        'sub_sport': _field(msg, 'sub_sport'),
                        'total_cycles': _field(msg, 'total_cycles'),
                        'total_distance': _field(msg, 'total_distance'),
                    })
            item['monitoring_count'] = len(item['monitoring'])
            item['monitoring'] = item['monitoring'][:400]
        except Exception as exc:
            item['error'] = str(exc)
        result.append(item)
    return result


def _save_snapshot(day, files):
    payload={'day':day,'files':files}
    now=datetime.now(timezone.utc).isoformat()
    r=requests.post(
        f'{app_core.SUPABASE_URL}/rest/v1/garmin_fit_diagnostics?on_conflict=day',
        headers=app_core.headers({'Prefer':'resolution=merge-duplicates,return=minimal'}),
        json=[{'day':day,'payload':payload,'updated_at':now}],
        timeout=25
    )
    r.raise_for_status()


def diagnose_fit_steps():
    day = str(request.args.get('day') or '2026-09-24')[:10]
    try:
        files = _diagnose_day(day)
        saved=False
        if request.args.get('save') == '1':
            _save_snapshot(day, files)
            saved=True
        return jsonify({'ok': True, 'day': day, 'saved': saved, 'files': files})
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500

app.add_url_rule('/api/fit/diagnose-steps','fit_diagnose_steps',app_core.auth(diagnose_fit_steps),methods=['GET'])
