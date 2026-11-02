import io
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import requests
from fitparse import FitFile
from flask import jsonify, request

import app_core
from fit_folder import app

LOCAL_TZ = ZoneInfo('America/Argentina/Buenos_Aires')
KNOWN_EXERCISE_TITLES={(31,32):'Estiramiento de glúteos',(28,62):'Sentadilla lastrada',(1,20):'Elevación de gemelos de pie con mancuernas',(19,43):'Plancha',(28,69):'Sentadilla de sumo',(6,34):'Extensiones de piernas lastradas'}

def _v(msg,*names):
    for name in names:
        try:
            value=msg.get_value(name)
            if value is not None:return value
        except Exception:pass
    return None

def _num(value):
    try:return float(value) if value is not None else None
    except Exception:return None

def _int(value):
    try:return int(round(float(value))) if value is not None else None
    except Exception:return None

def _first(value):return value[0] if isinstance(value,(list,tuple)) and value else value

def _jsonable(value):
    if isinstance(value,datetime):return value.isoformat()
    if isinstance(value,(list,tuple)):return [_jsonable(v) for v in value]
    if isinstance(value,dict):return {str(k):_jsonable(v) for k,v in value.items()}
    if isinstance(value,(str,int,float,bool)) or value is None:return value
    return str(value)

def _msg_dict(msg):
    out={}
    for field in getattr(msg,'fields',[]) or []:
        try:out[field.name]=_jsonable(field.value)
        except Exception:pass
    return out

def _download_fit(storage_path):
    url=f'{app_core.SUPABASE_URL}/storage/v1/object/authenticated/{app_core.FIT_BUCKET}/{storage_path}'
    r=requests.get(url,headers={'apikey':app_core.SUPABASE_KEY,'Authorization':f'Bearer {app_core.SUPABASE_KEY}'},timeout=35);r.raise_for_status();return r.content

def _patch_fit(sha,status):
    r=requests.patch(f'{app_core.SUPABASE_URL}/rest/v1/garmin_fit_files?file_sha256=eq.{sha}',headers=app_core.headers({'Prefer':'return=minimal'}),json={'status':status},timeout=20);r.raise_for_status()

def _daily_base(day):
    existing=app_core.select('daily_health',f'select=*&date=eq.{day}&limit=1')
    return existing[0] if existing else {'date':day,'steps':None,'distance_m':None,'active_seconds':None,'active_calories':None,'sleep_seconds':None,'hrv_rmssd':None,'resting_hr':None,'weight_kg':None,'skin_temp_c':None,'source_fit':False,'source_tredict':False}

def _write_daily(day,values,keep_max=True):
    row=_daily_base(day)
    cumulative={'steps','distance_m','active_seconds','active_calories'}
    for key,value in values.items():
        if value is None:continue
        if keep_max and key in cumulative and row.get(key) is not None:
            try:value=max(float(row[key]),float(value))
            except Exception:pass
        if key in {'steps','active_seconds','active_calories'} and value is not None:value=_int(value)
        row[key]=value
    row['source_fit']=True;row['updated_at']=datetime.now(timezone.utc).isoformat()
    allowed={'date','steps','distance_m','active_seconds','active_calories','sleep_seconds','hrv_rmssd','resting_hr','weight_kg','skin_temp_c','source_fit','source_tredict','updated_at'}
    row={k:v for k,v in row.items() if k in allowed}
    r=requests.post(f'{app_core.SUPABASE_URL}/rest/v1/daily_health?on_conflict=date',headers=app_core.headers({'Prefer':'resolution=merge-duplicates,return=minimal'}),json=[row],timeout=20);r.raise_for_status()

def _upsert_daily(day,values):
    _write_daily(day,values,keep_max=True)

def _activity_type(msg):
    raw=_v(msg,'activity_type')
    if raw is None:return 'unknown'
    return str(raw).strip().lower()

def _monitoring_fields(msg):
    activity=_activity_type(msg)
    steps=_v(msg,'steps')
    if steps is None and activity in {'walking','running'}:
        steps=_v(msg,'cycles')
    return {
        'activity_type':activity,
        'steps':steps,
        'distance_m':_v(msg,'distance'),
        'active_seconds':_v(msg,'active_time'),
        'active_calories':_v(msg,'active_calories','calories'),
    }

def _local_monitoring_datetime(msg):
    local_ts=_v(msg,'local_timestamp')
    if isinstance(local_ts,datetime):
        if local_ts.tzinfo is not None:return local_ts.astimezone(LOCAL_TZ).replace(tzinfo=None)
        return local_ts
    ts=_v(msg,'timestamp')
    if not isinstance(ts,datetime):return None
    if ts.tzinfo is None:ts=ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(LOCAL_TZ).replace(tzinfo=None)

def _monitoring_day_and_time(msg,fallback_date,vals):
    dt=_local_monitoring_datetime(msg)
    if dt is None:
        day=str(fallback_date or '')[:10] or None
        return day,None
    day=dt.date()
    positive=any((_num(v) or 0)>0 for k,v in vals.items() if k!='activity_type')
    if dt.hour==0 and dt.minute==0 and dt.second==0 and dt.microsecond==0 and positive:
        day-=timedelta(days=1)
    return day.isoformat(),dt

def _counter_total(points,key):
    vals=[]
    for _,row in sorted(points.items(),key=lambda x:x[0]):
        v=row.get(key)
        if v is not None:vals.append(float(v))
    if not vals:return None
    total=vals[0];prev=vals[0]
    for v in vals[1:]:
        if v>=prev:total+=v-prev
        else:total+=v
        prev=v
    return total

def _monitoring_daily_values(messages,fallback_date=None):
    samples={};fallback_seq=0
    for msg in messages:
        if msg.name!='monitoring':continue
        raw=_monitoring_fields(msg);activity=raw.pop('activity_type')
        vals={k:_num(v) for k,v in raw.items()}
        if all(v is None for v in vals.values()):continue
        day,dt=_monitoring_day_and_time(msg,fallback_date,{**vals,'activity_type':activity})
        if not day:continue
        if dt is not None:key=dt.isoformat(timespec='microseconds')
        else:
            fallback_seq+=1;key=f'zz-fallback-{fallback_seq:08d}'
        stream=samples.setdefault(day,{}).setdefault(activity,{})
        row=stream.setdefault(key,{'steps':None,'distance_m':None,'active_seconds':None,'active_calories':None})
        for field,value in vals.items():
            if value is not None:row[field]=max(row[field] or 0,value)
    out={}
    for day,streams in samples.items():
        step_parts=[];distance_parts=[];active_parts=[];calorie_parts=[]
        for activity,points in streams.items():
            s=_counter_total(points,'steps')
            if s is not None and activity in {'walking','running'}:step_parts.append(s)
            d=_counter_total(points,'distance_m')
            a=_counter_total(points,'active_seconds')
            c=_counter_total(points,'active_calories')
            if d is not None:distance_parts.append(d)
            if a is not None:active_parts.append(a)
            if c is not None:calorie_parts.append(c)
        # Do not add the `unknown` activity stream to steps. On these Garmin FITs
        # fitparse exposes a duplicate dynamic steps/cycles representation there,
        # which inflated valid daily totals by roughly 50%.
        out[day]={
            'steps':sum(step_parts) if step_parts else None,
            'distance_m':max(distance_parts) if distance_parts else None,
            'active_seconds':max(active_parts) if active_parts else None,
            'active_calories':max(calorie_parts) if calorie_parts else None,
        }
    return out

def _parse_monitoring(messages,folder_date):
    days=_monitoring_daily_values(messages,folder_date)
    for day,totals in days.items():
        _upsert_daily(day,{'steps':_int(totals['steps']),'distance_m':totals['distance_m'],'active_seconds':_int(totals['active_seconds']),'active_calories':_int(totals['active_calories'])})
    return bool(days)

def _parse_strength(messages,file_row):
    sessions=[m for m in messages if m.name=='session'];sets=[m for m in messages if m.name=='set']
    if not sets:return False
    session=sessions[-1] if sessions else None;sport=str(_v(session,'sport') if session else '');sub_sport=str(_v(session,'sub_sport') if session else '')
    title=_v(session,'sport_profile_name','name') if session else None;title=title or ('Fuerza' if 'strength' in (sport+sub_sport).lower() else 'Entrenamiento de fuerza');day=str(file_row.get('folder_date') or '')[:10]
    existing=app_core.select('garmin_strength_imports',f"select=id&file_sha256=eq.{file_row.get('file_sha256')}&limit=1")
    if existing:return True
    imported=app_core.insert('garmin_strength_imports',[{'date':day or None,'title':str(title),'filename':file_row.get('filename'),'file_sha256':file_row.get('file_sha256'),'duration_s':_num(_v(session,'total_elapsed_time','total_timer_time') if session else None),'calories':_int(_v(session,'total_calories') if session else None),'hr_avg':_int(_v(session,'avg_heart_rate') if session else None),'hr_max':_int(_v(session,'max_heart_rate') if session else None),'raw_json':{'session':_msg_dict(session) if session else {},'sport':sport,'sub_sport':sub_sport}}],True)[0]
    title_by_pair=dict(KNOWN_EXERCISE_TITLES)
    for msg in messages:
        if msg.name!='exercise_title':continue
        category=_int(_first(_v(msg,'exercise_category','category')));subtype=_int(_first(_v(msg,'exercise_name','category_subtype','exercise_subtype')));text=_v(msg,'wkt_step_name','title','name')
        if category is not None and subtype is not None and text:title_by_pair[(category,subtype)]=str(text)
    out=[];active_no=0
    for msg in sets:
        set_type=_v(msg,'set_type');is_active=str(set_type or '').lower()=='active' or set_type==1 or str(set_type)=='1'
        if not is_active:continue
        active_no+=1;category=_int(_first(_v(msg,'category','exercise_category')));subtype=_int(_first(_v(msg,'category_subtype','exercise_subtype')));name=title_by_pair.get((category,subtype)) or 'Ejercicio Garmin'
        out.append({'import_id':imported['id'],'set_number':active_no,'set_type':'active','exercise_name_garmin':name,'exercise_category':category,'exercise_subtype':subtype,'duration_s':_num(_v(msg,'duration')),'reps':_int(_v(msg,'repetitions','reps')),'weight_kg':_num(_v(msg,'weight')),'muscles_primary':[],'muscles_secondary':[]})
    if out:app_core.insert('garmin_strength_sets',out,False)
    return True

def process_fit_row(file_row):
    data=_download_fit(file_row['storage_path']);messages=list(FitFile(io.BytesIO(data)).get_messages())
    got_daily=_parse_monitoring(messages,str(file_row.get('folder_date') or '')[:10]);got_strength=_parse_strength(messages,file_row)
    status='parsed' if (got_daily or got_strength) else 'parsed_no_data';_patch_fit(file_row['file_sha256'],status);return status

def process_pending(limit=25):
    rows=app_core.select('garmin_fit_files',f'select=id,file_sha256,filename,storage_path,folder_date,status&status=in.(uploaded,error)&order=folder_date.asc&limit={int(limit)}')
    stats={'processed':0,'parsed':0,'no_data':0,'failed':0,'errors':[]}
    for row in rows:
        try:
            status=process_fit_row(row);stats['processed']+=1;stats['parsed' if status=='parsed' else 'no_data']+=1
        except Exception as exc:
            stats['processed']+=1;stats['failed']+=1;stats['errors'].append(f"{row.get('filename')}: {exc}")
            try:_patch_fit(row.get('file_sha256'),'error')
            except Exception:pass
    try:stats['remaining']=len(app_core.select('garmin_fit_files','select=id&status=in.(uploaded,error)&limit=5000'))
    except Exception:stats['remaining']=None
    return stats

def reprocess_wellness(limit=500):
    rows=app_core.select('garmin_fit_files',f"select=file_sha256,filename,storage_path,folder_date,status&filename=like.*_WELLNESS.fit&order=folder_date.asc,filename.asc&limit={int(limit)}")
    all_messages=[];errors=[];processed=0;fallback_date=None
    for row in rows:
        try:
            data=_download_fit(row['storage_path']);messages=list(FitFile(io.BytesIO(data)).get_messages())
            all_messages.extend(messages);fallback_date=fallback_date or str(row.get('folder_date') or '')[:10];processed+=1
        except Exception as exc:errors.append(f"{row.get('filename')}: {exc}")
    by_day=_monitoring_daily_values(all_messages,fallback_date)
    for day,vals in by_day.items():
        _write_daily(day,{'steps':_int(vals['steps']),'distance_m':vals['distance_m'],'active_seconds':_int(vals['active_seconds']),'active_calories':_int(vals['active_calories'])},keep_max=False)
    total_rows=app_core.select('garmin_fit_files','select=id&filename=like.*_WELLNESS.fit&limit=5000')
    return {'processed':processed,'days':len(by_day),'total_wellness':len(total_rows),'errors':errors[:10]}

def fit_process():
    try:
        limit=min(50,max(1,int(request.args.get('limit','25'))));return jsonify({'ok':True,**process_pending(limit)})
    except Exception as exc:return jsonify({'ok':False,'error':str(exc)}),500

def fit_reprocess_wellness():
    try:
        limit=min(500,max(1,int(request.args.get('limit','500'))));return jsonify({'ok':True,**reprocess_wellness(limit)})
    except Exception as exc:return jsonify({'ok':False,'error':str(exc)}),500

app.add_url_rule('/api/fit/process','fit_process',app_core.auth(fit_process),methods=['POST'])
app.add_url_rule('/api/fit/reprocess-wellness','fit_reprocess_wellness',app_core.auth(fit_reprocess_wellness),methods=['POST'])
