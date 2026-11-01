import io
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from fitparse import FitFile
from flask import jsonify

import app_core
from fit_folder import app
import garmin_parser

LOCAL_TZ = ZoneInfo('America/Argentina/Buenos_Aires')
FIT_EPOCH = datetime(1989, 12, 31, tzinfo=timezone.utc)
ACTIVITY_MAP = {1:'running', 6:'walking'}


def _v(msg,*names):
    for name in names:
        try:
            v=msg.get_value(name)
            if v is not None:return v
        except Exception:pass
    return None


def _num(v):
    try:return float(v) if v is not None else None
    except Exception:return None


def _fit_seconds(dt):
    if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
    return int((dt.astimezone(timezone.utc)-FIT_EPOCH).total_seconds())


def _from_fit_seconds(sec):
    return FIT_EPOCH + timedelta(seconds=int(sec))


def _activity_type(msg):
    raw=_v(msg,'activity_type')
    if raw is not None:
        s=str(raw).strip().lower()
        if s not in {'none','unknown','invalid'}:return s
    packed=_v(msg,'current_activity_type_intensity')
    try:
        code=int(packed)&0x1f
        return ACTIVITY_MAP.get(code,'unknown')
    except Exception:return 'unknown'


def _fields(msg):
    activity=_activity_type(msg)
    steps=_v(msg,'steps')
    if steps is None and activity in {'walking','running'}:
        steps=_v(msg,'cycles')
    if steps is None and activity in {'walking','running','unknown'}:
        c16=_num(_v(msg,'cycles_16'))
        if c16 is not None:steps=c16*2.0

    distance=_v(msg,'distance')
    if distance is None:
        d16=_num(_v(msg,'distance_16'))
        if d16 is not None:distance=d16*100.0

    active=_v(msg,'active_time')
    if active is None:active=_v(msg,'active_time_16')

    return {
        'activity':activity,
        'steps':_num(steps),
        'distance_m':_num(distance),
        'active_seconds':_num(active),
        'active_calories':_num(_v(msg,'active_calories','calories')),
    }


def _resolved_samples(messages,folder_date):
    samples=[]
    last_fit_ts=None
    fallback_seq=0

    for msg in messages:
        full=_v(msg,'timestamp')
        if isinstance(full,datetime):
            last_fit_ts=_fit_seconds(full)

        if msg.name!='monitoring':
            continue

        vals=_fields(msg)
        if all(vals[k] is None for k in ('steps','distance_m','active_seconds','active_calories')):
            continue

        local=_v(msg,'local_timestamp')
        dt_local=None
        if isinstance(local,datetime):
            dt_local=local.astimezone(LOCAL_TZ).replace(tzinfo=None) if local.tzinfo else local
        elif isinstance(full,datetime):
            dt=full.replace(tzinfo=timezone.utc) if full.tzinfo is None else full
            dt_local=dt.astimezone(LOCAL_TZ).replace(tzinfo=None)
        else:
            ts16=_v(msg,'timestamp_16')
            if ts16 is not None and last_fit_ts is not None:
                try:
                    ts16=int(ts16)
                    reconstructed=last_fit_ts + ((ts16-(last_fit_ts & 0xffff)) & 0xffff)
                    last_fit_ts=reconstructed
                    dt_local=_from_fit_seconds(reconstructed).astimezone(LOCAL_TZ).replace(tzinfo=None)
                except Exception:pass

        if dt_local is None:
            try:dt_local=datetime.fromisoformat(str(folder_date)[:10]) + timedelta(microseconds=fallback_seq)
            except Exception:continue
            fallback_seq+=1

        day=dt_local.date()
        if dt_local.hour==0 and dt_local.minute==0 and dt_local.second==0 and any((vals[k] or 0)>0 for k in ('steps','distance_m','active_seconds','active_calories')):
            day-=timedelta(days=1)
        samples.append((day.isoformat(),dt_local,vals))

    return samples


def _counter_total(points,key):
    vals=[p[2].get(key) for p in sorted(points,key=lambda x:x[1]) if p[2].get(key) is not None]
    if not vals:return None
    total=float(vals[0]);prev=float(vals[0])
    for raw in vals[1:]:
        v=float(raw)
        total += (v-prev) if v>=prev else v
        prev=v
    return total


def _rebuild(limit=500):
    rows=app_core.select('garmin_fit_files',f"select=file_sha256,filename,storage_path,folder_date,status&filename=like.*_WELLNESS.fit&order=folder_date.asc,filename.asc&limit={int(limit)}")
    all_samples=[];errors=[];processed=0
    for row in rows:
        try:
            data=garmin_parser._download_fit(row['storage_path'])
            messages=list(FitFile(io.BytesIO(data)).get_messages())
            all_samples.extend(_resolved_samples(messages,row.get('folder_date')))
            processed+=1
        except Exception as exc:
            errors.append(f"{row.get('filename')}: {exc}")

    # Deduplicate overlapping exports by day + activity + exact resolved time.
    dedup={}
    for day,dt,vals in all_samples:
        activity=vals.get('activity') or 'unknown'
        key=(day,activity,dt.isoformat(timespec='microseconds'))
        cur=dedup.setdefault(key,{'day':day,'dt':dt,'activity':activity,'steps':None,'distance_m':None,'active_seconds':None,'active_calories':None})
        for f in ('steps','distance_m','active_seconds','active_calories'):
            v=vals.get(f)
            if v is not None:cur[f]=max(cur[f] or 0,v)

    by_day={}
    for row in dedup.values():
        by_day.setdefault(row['day'],{}).setdefault(row['activity'],[]).append((row['day'],row['dt'],row))

    rebuilt={}
    for day,streams in by_day.items():
        step_parts=[];dist_parts=[];active_parts=[];cal_parts=[]
        for activity,pts in streams.items():
            s=_counter_total(pts,'steps')
            if s is not None and activity in {'walking','running','unknown'}:step_parts.append(s)
            d=_counter_total(pts,'distance_m');a=_counter_total(pts,'active_seconds');c=_counter_total(pts,'active_calories')
            if d is not None:dist_parts.append(d)
            if a is not None:active_parts.append(a)
            if c is not None:cal_parts.append(c)
        rebuilt[day]={
            'steps':round(sum(step_parts)) if step_parts else None,
            'distance_m':max(dist_parts) if dist_parts else None,
            'active_seconds':round(max(active_parts)) if active_parts else None,
            'active_calories':round(max(cal_parts)) if cal_parts else None,
        }

    for day,vals in rebuilt.items():
        garmin_parser._write_daily(day,vals,keep_max=False)

    return {'processed':processed,'days':len(rebuilt),'errors':errors[:10]}


def fit_reprocess_wellness_v2():
    try:return jsonify({'ok':True,**_rebuild(500)})
    except Exception as exc:return jsonify({'ok':False,'error':str(exc)}),500

# Replace the existing view behind /api/fit/reprocess-wellness without changing the URL.
app.view_functions['fit_reprocess_wellness']=app_core.auth(fit_reprocess_wellness_v2)
