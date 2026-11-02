from datetime import datetime
from flask import jsonify, request

import app_core
from fit_folder import app


def _rows(table, query):
    try:return app_core.select(table, query)
    except Exception:return []

def _day(v):return str(v or '')[:10]

def _num(v):
    try:return float(v)
    except Exception:return None

def _pct(cur,prev):
    cur,prev=_num(cur),_num(prev)
    if cur is None or prev in (None,0):return None
    return (cur-prev)*100.0/abs(prev)

def _source_for(row, field):
    if field in ('steps','distance_m','active_seconds','active_calories') and row.get('source_fit'):return 'Garmin FIT'
    if field in ('sleep_seconds','hrv_rmssd','resting_hr') and row.get('source_tredict'):return 'Tredict'
    if row.get('source_fit'):return 'Garmin FIT'
    if row.get('source_tredict'):return 'Tredict'
    return 'Sin fuente'

def _latest_date():
    rows=_rows('daily_health','select=date&or=(steps.not.is.null,sleep_seconds.not.is.null,hrv_rmssd.not.is.null,resting_hr.not.is.null)&order=date.desc&limit=1')
    weight=_rows('body_weight_records','select=measurement_date&order=measurement_date.desc&limit=1')
    candidates=[_day(rows[0].get('date'))] if rows else []
    if weight:candidates.append(_day(weight[0].get('measurement_date')))
    return max(candidates) if candidates else None

def _weight_for(day):
    rows=_rows('body_weight_records',f'select=measurement_date,weight_kg&measurement_date=eq.{day}&limit=1')
    return rows[0] if rows else None

def _previous_weight(day):
    rows=_rows('body_weight_records',f'select=measurement_date,weight_kg&measurement_date=lt.{day}&order=measurement_date.desc&limit=1')
    return rows[0] if rows else None

def _previous_daily(day,field):
    rows=_rows('daily_health',f'select=date,{field}&date=lt.{day}&{field}=not.is.null&order=date.desc&limit=1')
    return rows[0] if rows else None

def _strength_for(day):
    manual=_rows('workout_sessions',f'select=id,date,title,source,created_at&date=eq.{day}&order=created_at.desc&limit=1')
    garmin=_rows('garmin_strength_imports',f'select=id,date,title,duration_s,calories,hr_avg,hr_max,created_at&date=eq.{day}&order=created_at.desc&limit=1')
    candidates=[]
    if manual:candidates.append({'kind':'manual','source':'Registro de fuerza',**manual[0]})
    if garmin:candidates.append({'kind':'garmin','source':'Garmin FIT',**garmin[0]})
    candidates.sort(key=lambda x:str(x.get('created_at') or ''),reverse=True)
    return candidates[0] if candidates else None

def _sports_for(day):
    rows=_rows('tredict_activities',f'select=id,date,title,sport,duration_s&date=eq.{day}&order=date.desc&limit=100')
    sport=[]
    for x in rows:
        text=f"{x.get('sport') or ''} {x.get('title') or ''}".lower()
        if not any(k in text for k in ('strength','fuerza','gym','weight')):sport.append(x)
    return sport

@app.get('/api/dashboard/day')
@app_core.auth
def dashboard_day():
    selected=request.args.get('date') or _latest_date()
    if not selected:return jsonify({'date':None,'latest_date':None,'available_dates':[],'values':{}})
    try:datetime.strptime(selected,'%Y-%m-%d')
    except Exception:return jsonify({'error':'Fecha inválida'}),400
    rows=_rows('daily_health',f'select=*&date=eq.{selected}&limit=1');row=rows[0] if rows else {}
    dates=_rows('daily_health','select=date&or=(steps.not.is.null,sleep_seconds.not.is.null,hrv_rmssd.not.is.null,resting_hr.not.is.null)&order=date.asc&limit=1200')
    weight_dates=_rows('body_weight_records','select=measurement_date&order=measurement_date.asc&limit=1200')
    available=sorted(set([_day(x.get('date')) for x in dates if x.get('date')]+[_day(x.get('measurement_date')) for x in weight_dates if x.get('measurement_date')]))
    sports=_sports_for(selected);strength=_strength_for(selected);weight=_weight_for(selected);prev_weight=_previous_weight(selected)
    prev_steps=_previous_daily(selected,'steps');prev_sleep=_previous_daily(selected,'sleep_seconds');prev_hrv=_previous_daily(selected,'hrv_rmssd');prev_rhr=_previous_daily(selected,'resting_hr')
    return jsonify({'date':selected,'latest_date':_latest_date(),'available_dates':available,'values':{
        'weight':{'value':weight.get('weight_kg') if weight else None,'source':'Registro manual' if weight else None,'change':(_num(weight.get('weight_kg'))-_num(prev_weight.get('weight_kg'))) if weight and prev_weight else None,'previous_date':_day(prev_weight.get('measurement_date')) if prev_weight else None},
        'steps':{'value':row.get('steps'),'source':_source_for(row,'steps') if row.get('steps') is not None else None,'change_pct':_pct(row.get('steps'),prev_steps.get('steps')) if prev_steps else None,'previous_date':_day(prev_steps.get('date')) if prev_steps else None},
        'sleep':{'value':row.get('sleep_seconds'),'source':_source_for(row,'sleep_seconds') if row.get('sleep_seconds') is not None else None,'change_pct':_pct(row.get('sleep_seconds'),prev_sleep.get('sleep_seconds')) if prev_sleep else None,'previous_date':_day(prev_sleep.get('date')) if prev_sleep else None},
        'hrv':{'value':row.get('hrv_rmssd'),'source':_source_for(row,'hrv_rmssd') if row.get('hrv_rmssd') is not None else None,'change_pct':_pct(row.get('hrv_rmssd'),prev_hrv.get('hrv_rmssd')) if prev_hrv else None,'previous_date':_day(prev_hrv.get('date')) if prev_hrv else None},
        'rhr':{'value':row.get('resting_hr'),'source':_source_for(row,'resting_hr') if row.get('resting_hr') is not None else None,'change_pct':_pct(row.get('resting_hr'),prev_rhr.get('resting_hr')) if prev_rhr else None,'previous_date':_day(prev_rhr.get('date')) if prev_rhr else None},
        'sport':{'value':sum(float(x.get('duration_s') or 0) for x in sports)/60.0,'source':'Tredict' if sports else None,'count':len(sports)},
        'strength':{'value':strength.get('title') if strength else None,'source':strength.get('source') if strength else None,'kind':strength.get('kind') if strength else None,'id':strength.get('id') if strength else None,'duration_s':strength.get('duration_s') if strength else None,'calories':strength.get('calories') if strength else None,'hr_avg':strength.get('hr_avg') if strength else None},
    }})
