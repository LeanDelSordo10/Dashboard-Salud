import os
from datetime import datetime
from functools import wraps
from urllib.parse import quote
import requests
from flask import Flask, request, jsonify, session, redirect

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'change-me')
PASSWORD = os.getenv('DASHBOARD_PASSWORD', '')
SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.getenv('SUPABASE_SECRET_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
FIT_BUCKET = os.getenv('SUPABASE_FIT_BUCKET', 'fit-files')

STYLE = '''<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090b0e;color:#f5f7fa;font-family:Inter,system-ui,Arial}.wrap{max-width:920px;margin:auto;padding:16px}.top,.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.card{background:#111419;border:1px solid #282e36;border-radius:16px;padding:16px;margin:12px 0}.btn{border:0;border-radius:11px;padding:11px 15px;background:#ed1939;color:white;font-weight:800;text-decoration:none;cursor:pointer}.alt{background:#1a2028;border:1px solid #343b45}.muted{color:#9da7b4}.label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#9da7b4}input,select{background:#0b0e12;border:1px solid #343c47;color:white;border-radius:10px;padding:11px;width:100%}.tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tab{padding:12px 6px;text-align:center;background:#171c23;border:1px solid #303844;border-radius:11px;font-weight:800;cursor:pointer}.tab.on{background:#ed1939;border-color:#ed1939}.exercise{background:#10141a;border:1px solid #262e38;border-radius:14px;padding:14px;margin:10px 0}.exhead{display:grid;grid-template-columns:1fr auto;gap:10px}.target,.last{font-size:13px;margin-top:5px}.last{color:#9da7b4}.setrow{display:grid;grid-template-columns:42px 1fr 1fr;gap:8px;margin:7px 0}.n{display:grid;place-items:center;background:#1a2028;border:1px solid #343b45;border-radius:10px;font-weight:900}.ok{color:#7ee787}.bad{color:#ff7b86}.saved{border-color:#2d8a55}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpi{background:#111419;border:1px solid #282e36;border-radius:16px;padding:16px}.big{font-size:28px;font-weight:900}@media(max-width:650px){.tabs,.kpis{grid-template-columns:repeat(2,1fr)}.exhead{grid-template-columns:1fr}.wrap{padding:11px}}</style>'''

def page(body, title='Dashboard Salud'):
    return f"<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title>{STYLE}</head><body>{body}</body></html>"

def auth(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not session.get('ok'):
            return (jsonify({'error':'No autorizado'}),401) if request.path.startswith('/api/') else redirect('/login')
        return fn(*args, **kwargs)
    return wrapped

def headers(extra=None):
    h={'apikey':SUPABASE_KEY,'Authorization':f'Bearer {SUPABASE_KEY}','Content-Type':'application/json'}
    if extra: h.update(extra)
    return h

def select(table, query=''):
    r=requests.get(f'{SUPABASE_URL}/rest/v1/{table}'+(('?'+query) if query else ''),headers=headers(),timeout=25)
    r.raise_for_status(); return r.json()

def insert(table, rows, returning=True):
    pref='return=representation' if returning else 'return=minimal'
    r=requests.post(f'{SUPABASE_URL}/rest/v1/{table}',headers=headers({'Prefer':pref}),json=rows,timeout=25)
    r.raise_for_status(); return r.json() if returning and r.text else []

@app.route('/login',methods=['GET','POST'])
def login():
    err=''
    if request.method=='POST':
        if PASSWORD and request.form.get('password')==PASSWORD:
            session['ok']=True; return redirect('/')
        err="<p class='bad'>Contraseña incorrecta.</p>"
    return page(f"<div class='wrap' style='max-width:420px;padding-top:12vh'><div class='card'><h2>Dashboard Salud</h2><div class='muted'>Acceso privado</div><form method='post'><input style='margin-top:18px' type='password' name='password' placeholder='Contraseña'><button class='btn' style='width:100%;margin-top:10px'>Ingresar</button>{err}</form></div></div>")

@app.get('/')
@auth
def home():
    return page("""<div class='wrap'><div class='top'><div><h2>Dashboard Salud</h2><div class='muted'>Garmin · Tredict · Fuerza</div></div><div><a class='btn alt' href='/fit-upload'>Subir FIT</a> <a class='btn' href='/gym'>Gym móvil</a></div></div><div class='kpis'><div class='kpi'><div class='label'>Peso</div><div class='big' id='w'>—</div></div><div class='kpi'><div class='label'>Pasos</div><div class='big' id='s'>—</div></div><div class='kpi'><div class='label'>HRV</div><div class='big' id='h'>—</div></div><div class='kpi'><div class='label'>FC reposo</div><div class='big' id='r'>—</div></div></div><div class='card'><h3>Salud reciente</h3><div id='recent' class='muted'>Cargando...</div></div></div><script>fetch('/api/health/recent').then(x=>x.json()).then(d=>{if(!Array.isArray(d))return;let a=d[0]||{};s.textContent=a.steps??'—';h.textContent=a.hrv_rmssd??'—';r.textContent=a.resting_hr??'—';let z=d.find(x=>x.weight_kg!=null);w.textContent=z?z.weight_kg+' kg':'—';recent.innerHTML=d.slice(0,10).map(x=>`${x.date} · ${x.steps??'—'} pasos · ${x.hrv_rmssd??'—'} HRV`).join('<br>')||'Sin datos todavía'})</script>""")

GYM = """<div class='wrap'><div class='top'><div><h2>Gym móvil</h2><div class='muted'>Rutina 4 días · registro real</div></div><a class='btn alt' href='/'>Dashboard</a></div><div class='card'><div class='label'>Elegí el entrenamiento</div><div class='tabs' id='tabs' style='margin-top:10px'><div class='tab on' data-day='Upper A'>Upper A</div><div class='tab' data-day='Lower A'>Lower A</div><div class='tab' data-day='Upper B'>Upper B</div><div class='tab' data-day='Lower B'>Lower B</div></div></div><div id='list'></div><div id='global' class='card muted'>El peso objetivo es solo una referencia.</div></div><script>
let catalog=[],day='Upper A',sessionId=null;const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');async function api(u,o){let r=await fetch(u,o),d=await r.json();if(!r.ok)throw Error(d.error||'Error');return d}async function boot(){catalog=await api('/api/exercises');document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');day=t.dataset.day;sessionId=null;loadDay()});await loadDay()}async function loadDay(){list.innerHTML="<div class='card muted'>Cargando rutina...</div>";try{let d=await api('/api/routine/'+encodeURIComponent(day));d.sort((a,b)=>Number(a.position)-Number(b.position));list.innerHTML='';if(!d.length){list.innerHTML="<div class='card bad'>No se encontraron ejercicios para este día.</div>";return}for(const x of d){await render(x)}}catch(e){list.innerHTML=`<div class='card bad'>${esc(e.message)}</div>`}}async function render(x){let last=null;try{last=(await api('/api/exercises/'+x.exercise_id+'/last')).last}catch(e){}let opts=catalog.map(e=>`<option value='${e.id}' ${e.id===x.exercise_id?'selected':''}>${esc(e.name)}</option>`).join('');let div=document.createElement('div');div.className='exercise';div.innerHTML=`<div class='exhead'><div><b>${x.position}. ${esc(x.exercise_name)}</b><div class='target'>Objetivo: ${x.target_sets} series · ${x.target_reps_min??''}${x.target_reps_max&&x.target_reps_max!==x.target_reps_min?'–'+x.target_reps_max:''}${x.target_reps_min?' reps':''}${x.target_weight_kg?' · '+Number(x.target_weight_kg)+' kg':''}</div><div class='last'>${last?`Último real: ${last.weight_kg??'—'} kg × ${last.reps??'—'} reps · ${String(last.performed_at||'').slice(0,10)}`:'Sin registro previo'}</div></div><div><div class='label'>Ejercicio realizado</div><select class='pick'>${opts}</select></div></div><div class='sets'></div><div class='row' style='justify-content:flex-start;margin-top:8px'><button class='btn alt add'>+ Serie</button><button class='btn save'>Guardar</button><span class='msg'></span></div>`;list.appendChild(div);let box=div.querySelector('.sets');for(let i=0;i<x.target_sets;i++)addSet(box,last?.weight_kg??x.target_weight_kg??'','');div.querySelector('.add').onclick=()=>addSet(box);div.querySelector('.pick').onchange=async e=>{let l=(await api('/api/exercises/'+e.target.value+'/last')).last;div.querySelector('.last').textContent=l?`Último real: ${l.weight_kg??'—'} kg × ${l.reps??'—'} reps · ${String(l.performed_at||'').slice(0,10)}`:'Sin registro previo'};div.querySelector('.save').onclick=()=>saveEx(div,x)}function addSet(box,w='',r=''){let n=box.children.length+1,d=document.createElement('div');d.className='setrow';d.innerHTML=`<div class='n'>${n}</div><input inputmode='decimal' placeholder='kg' value='${w??''}'><input inputmode='numeric' placeholder='reps' value='${r??''}'>`;box.appendChild(d)}async function ensureSession(){if(sessionId)return sessionId;let d=await api('/api/workouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:day})});sessionId=d.id;return sessionId}async function saveEx(div,x){let m=div.querySelector('.msg');try{let sid=await ensureSession(),eid=div.querySelector('.pick').value,rows=[...div.querySelector('.sets').children].map((d,i)=>({set_number:i+1,weight_kg:d.children[1].value===''?null:Number(d.children[1].value),reps:d.children[2].value===''?null:Number(d.children[2].value)})).filter(z=>z.weight_kg!=null||z.reps!=null);let d=await api('/api/workouts/'+sid+'/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exercise_id:eid,planned_exercise_id:x.exercise_id,sets:rows})});m.innerHTML=`<span class='ok'>✓ ${d.sets} series</span>`;div.classList.add('saved')}catch(e){m.innerHTML=`<span class='bad'>${esc(e.message)}</span>`}}boot()</script>"""

@app.get('/gym')
@auth
def gym(): return page(GYM,'Gym móvil')

@app.get('/fit-upload')
@auth
def fit_page():
    return page("""<div class='wrap'><div class='top'><h2>Carga Garmin FIT</h2><a class='btn alt' href='/'>Dashboard</a></div><div class='card'><input id='files' type='file' multiple accept='.fit'><button class='btn' id='up' style='margin-top:10px'>Subir archivos</button><pre id='msg'></pre></div></div><script>up.onclick=async()=>{let fd=new FormData();for(let f of files.files)fd.append('files',f);let r=await fetch('/api/fit/upload',{method:'POST',body:fd}),d=await r.json();msg.textContent=r.ok?'Listo: '+d.files+' archivo(s)':d.error}</script>""")

@app.get('/api/health/recent')
@auth
def health():
    try:return jsonify(select('daily_health','select=*&order=date.desc&limit=30'))
    except Exception as e:return jsonify({'error':str(e)}),500

@app.get('/api/exercises')
@auth
def exercises():
    try:return jsonify(select('exercises','select=id,name,primary_muscle,active&active=eq.true&order=name.asc'))
    except Exception as e:return jsonify({'error':str(e)}),500

@app.get('/api/exercises/<eid>/last')
@auth
def last(eid):
    try:
        z=select('workout_set_history',f'select=*&exercise_id=eq.{quote(eid,safe="")}&order=performed_at.desc,set_number.desc&limit=1')
        return jsonify({'last':z[0] if z else None})
    except Exception as e:return jsonify({'error':str(e)}),500

@app.get('/api/routine/<day>')
@auth
def routine(day):
    try:
        r=select('routine_templates','select=id&name=eq.Rutina%204%20d%C3%ADas&active=eq.true&limit=1')
        if not r:return jsonify([])
        rid=r[0]['id']; stored_day=quote(day,safe='')
        rows=select('routine_exercises',f'select=position,exercise_id,target_sets,target_reps_min,target_reps_max,target_weight_kg,notes&routine_id=eq.{rid}&day_code=eq.{stored_day}&order=position.asc')
        names={x['id']:x['name'] for x in select('exercises','select=id,name')}
        for x in rows:x['exercise_name']=names.get(x['exercise_id'],'Ejercicio')
        rows.sort(key=lambda x:int(x.get('position') or 0))
        return jsonify(rows)
    except Exception as e:return jsonify({'error':str(e)}),500

@app.post('/api/workouts')
@auth
def workout():
    try:
        b=request.get_json(silent=True) or {}; date=b.get('date') or datetime.now().date().isoformat(); title=(b.get('title') or 'Entrenamiento').strip()
        x=select('workout_sessions',f'select=id,date,title,status&date=eq.{date}&status=eq.open&title=eq.{quote(title,safe="")}&order=created_at.desc&limit=1')
        if x:return jsonify(x[0])
        return jsonify(insert('workout_sessions',[{'date':date,'title':title,'status':'open','source':'manual'}])[0])
    except Exception as e:return jsonify({'error':str(e)}),500

@app.post('/api/workouts/<sid>/sets')
@auth
def save_sets(sid):
    try:
        b=request.get_json(silent=True) or {}; rows=[{'session_id':sid,'exercise_id':b.get('exercise_id'),'planned_exercise_id':b.get('planned_exercise_id'),'set_number':s.get('set_number'),'weight_kg':s.get('weight_kg'),'reps':s.get('reps')} for s in b.get('sets',[])]
        if not rows:return jsonify({'error':'No hay series para guardar'}),400
        insert('workout_sets',rows,False); return jsonify({'ok':True,'sets':len(rows)})
    except Exception as e:return jsonify({'error':str(e)}),500

@app.post('/api/fit/upload')
@auth
def upload():
    try:
        done=[]
        for f in request.files.getlist('files'):
            if not f.filename.lower().endswith('.fit'):continue
            name=f"{datetime.utcnow().strftime('%Y/%m/%d')}/{datetime.utcnow().strftime('%H%M%S%f')}_{os.path.basename(f.filename)}"
            r=requests.post(f'{SUPABASE_URL}/storage/v1/object/{FIT_BUCKET}/{name}',headers={'apikey':SUPABASE_KEY,'Authorization':f'Bearer {SUPABASE_KEY}','Content-Type':'application/octet-stream'},data=f.read(),timeout=40);r.raise_for_status();done.append(name)
        return jsonify({'ok':True,'files':len(done)})
    except Exception as e:return jsonify({'error':str(e)}),500
