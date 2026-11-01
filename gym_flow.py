import requests
from flask import request, jsonify
import app_core

app = app_core.app

def delete_rows(table, query):
    r = requests.delete(
        f"{app_core.SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=app_core.headers({'Prefer':'return=minimal'}),
        timeout=25,
    )
    r.raise_for_status()

def patch_rows(table, query, payload):
    r = requests.patch(
        f"{app_core.SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=app_core.headers({'Prefer':'return=representation'}),
        json=payload,
        timeout=25,
    )
    r.raise_for_status()
    return r.json() if r.text else []

@app.post('/api/workouts/<sid>/exercise')
@app_core.auth
def replace_exercise_sets(sid):
    try:
        b = request.get_json(silent=True) or {}
        eid = b.get('exercise_id')
        planned = b.get('planned_exercise_id')
        if not eid or not planned:
            return jsonify({'error':'Falta identificar el ejercicio'}),400
        rows = [
            {
                'session_id':sid,
                'exercise_id':eid,
                'planned_exercise_id':planned,
                'set_number':s.get('set_number'),
                'weight_kg':s.get('weight_kg'),
                'reps':s.get('reps'),
            }
            for s in (b.get('sets') or [])
            if s.get('weight_kg') is not None or s.get('reps') is not None
        ]
        if not rows:
            return jsonify({'error':'Cargá al menos una serie'}),400
        delete_rows('workout_sets',f'session_id=eq.{sid}&planned_exercise_id=eq.{planned}')
        app_core.insert('workout_sets',rows,False)
        return jsonify({'ok':True,'sets':len(rows),'replaced':True})
    except Exception as e:
        return jsonify({'error':str(e)}),500

@app.post('/api/workouts/<sid>/finish')
@app_core.auth
def finish_workout(sid):
    try:
        rows = patch_rows('workout_sessions',f'id=eq.{sid}',{'status':'completed'})
        return jsonify({'ok':True,'session':rows[0] if rows else {'id':sid,'status':'completed'}})
    except Exception as e:
        return jsonify({'error':str(e)}),500

app_core.STYLE += '''<style>
.progress{height:8px;background:#202630;border-radius:99px;overflow:hidden;margin-top:10px}.progress>div{height:100%;background:#ed1939;width:0;transition:.25s}.toolbar{position:sticky;bottom:8px;z-index:5;background:rgba(17,20,25,.96);backdrop-filter:blur(10px);border:1px solid #303844;border-radius:16px;padding:12px;margin-top:14px}.done-title{display:flex;align-items:center;gap:8px}.check{display:none;width:22px;height:22px;border-radius:50%;background:#238636;color:white;place-items:center;font-size:13px}.saved .check{display:grid}.saved .save{background:#238636}.saved{opacity:.82}.finish{width:100%;font-size:16px;padding:14px}.finish:disabled{opacity:.45;cursor:not-allowed}.statusline{font-size:13px;color:#aab3bf;margin-top:8px}.sethead{display:grid;grid-template-columns:42px 1fr 1fr;gap:8px;margin-top:12px;color:#8f99a6;font-size:11px;text-transform:uppercase}.sethead div:not(:first-child){padding-left:10px}.save.busy{opacity:.55;pointer-events:none}
</style>'''

app_core.GYM = """<div class='wrap'><div class='top'><div><h2>Gym móvil</h2><div class='muted'>Rutina 4 días · registro real</div></div><a class='btn alt' href='/'>Dashboard</a></div><div class='card'><div class='label'>Elegí el entrenamiento</div><div class='tabs' id='tabs' style='margin-top:10px'><div class='tab on' data-day='Upper A'>Upper A</div><div class='tab' data-day='Lower A'>Lower A</div><div class='tab' data-day='Upper B'>Upper B</div><div class='tab' data-day='Lower B'>Lower B</div></div><div class='progress'><div id='bar'></div></div><div class='statusline' id='progressText'>0 ejercicios completados</div></div><div id='list'></div><div class='toolbar'><button class='btn finish' id='finish' disabled>Finalizar entrenamiento</button><div id='finishMsg' class='statusline'>Guardá los ejercicios que realices y después finalizá la sesión.</div></div></div><script>
let catalog=[],day='Upper A',sessionId=null,total=0,completed=new Set();
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function api(u,o){let r=await fetch(u,o),d=await r.json();if(!r.ok)throw Error(d.error||'Error');return d}
function progress(){let n=completed.size,p=total?Math.round(n*100/total):0;bar.style.width=p+'%';progressText.textContent=`${n} de ${total} ejercicios completados`;finish.disabled=n===0}
async function boot(){catalog=await api('/api/exercises');document.querySelectorAll('.tab').forEach(t=>t.onclick=async()=>{if(sessionId&&completed.size&&!confirm('Ya cargaste ejercicios. ¿Cambiar de rutina?'))return;document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');day=t.dataset.day;sessionId=null;completed.clear();await loadDay()});await loadDay()}
async function loadDay(){list.innerHTML="<div class='card muted'>Cargando rutina...</div>";try{let d=await api('/api/routine/'+encodeURIComponent(day));d.sort((a,b)=>Number(a.position)-Number(b.position));total=d.length;progress();list.innerHTML='';if(!d.length){list.innerHTML="<div class='card bad'>No se encontraron ejercicios para este día.</div>";return}for(const x of d)await render(x)}catch(e){list.innerHTML=`<div class='card bad'>${esc(e.message)}</div>`}}
async function render(x){let last=null;try{last=(await api('/api/exercises/'+x.exercise_id+'/last')).last}catch(e){}let opts=catalog.map(e=>`<option value='${e.id}' ${e.id===x.exercise_id?'selected':''}>${esc(e.name)}</option>`).join('');let div=document.createElement('div');div.className='exercise';div.dataset.planned=x.exercise_id;div.innerHTML=`<div class='exhead'><div><div class='done-title'><span class='check'>✓</span><b>${x.position}. ${esc(x.exercise_name)}</b></div><div class='target'>Objetivo: ${x.target_sets} series · ${x.target_reps_min??''}${x.target_reps_max&&x.target_reps_max!==x.target_reps_min?'–'+x.target_reps_max:''}${x.target_reps_min?' reps':''}${x.target_weight_kg?' · '+Number(x.target_weight_kg)+' kg':''}</div><div class='last'>${last?`Último real: ${last.weight_kg??'—'} kg × ${last.reps??'—'} reps · ${String(last.performed_at||'').slice(0,10)}`:'Sin registro previo'}</div></div><div><div class='label'>Ejercicio realizado</div><select class='pick'>${opts}</select></div></div><div class='sethead'><div></div><div>Peso kg</div><div>Reps</div></div><div class='sets'></div><div class='row' style='justify-content:flex-start;margin-top:8px'><button class='btn alt add'>+ Serie</button><button class='btn save'>Guardar</button><span class='msg'></span></div>`;list.appendChild(div);let box=div.querySelector('.sets');for(let i=0;i<x.target_sets;i++)addSet(box,last?.weight_kg??x.target_weight_kg??'','');div.querySelector('.add').onclick=()=>addSet(box);div.querySelector('.pick').onchange=async e=>{let l=(await api('/api/exercises/'+e.target.value+'/last')).last;div.querySelector('.last').textContent=l?`Último real: ${l.weight_kg??'—'} kg × ${l.reps??'—'} reps · ${String(l.performed_at||'').slice(0,10)}`:'Sin registro previo'};div.querySelector('.save').onclick=()=>saveEx(div,x)}
function addSet(box,w='',r=''){let n=box.children.length+1,d=document.createElement('div');d.className='setrow';d.innerHTML=`<div class='n'>${n}</div><input inputmode='decimal' placeholder='kg' value='${w??''}'><input inputmode='numeric' placeholder='reps' value='${r??''}'>`;box.appendChild(d)}
async function ensureSession(){if(sessionId)return sessionId;let d=await api('/api/workouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:day})});sessionId=d.id;return sessionId}
async function saveEx(div,x){let m=div.querySelector('.msg'),btn=div.querySelector('.save');try{btn.classList.add('busy');btn.textContent='Guardando...';let sid=await ensureSession(),eid=div.querySelector('.pick').value,rows=[...div.querySelector('.sets').children].map((d,i)=>({set_number:i+1,weight_kg:d.children[1].value===''?null:Number(d.children[1].value),reps:d.children[2].value===''?null:Number(d.children[2].value)})).filter(z=>z.weight_kg!=null||z.reps!=null);let d=await api('/api/workouts/'+sid+'/exercise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exercise_id:eid,planned_exercise_id:x.exercise_id,sets:rows})});m.innerHTML=`<span class='ok'>✓ ${d.sets} series guardadas</span>`;div.classList.add('saved');completed.add(x.exercise_id);btn.textContent='Actualizar';progress()}catch(e){m.innerHTML=`<span class='bad'>${esc(e.message)}</span>`;btn.textContent='Guardar'}finally{btn.classList.remove('busy')}}
finish.onclick=async()=>{if(!sessionId)return;let pending=total-completed.size;if(pending>0&&!confirm(`Quedan ${pending} ejercicios sin guardar. ¿Finalizar igual?`))return;try{finish.disabled=true;finish.textContent='Finalizando...';await api('/api/workouts/'+sessionId+'/finish',{method:'POST'});finish.textContent='✓ Entrenamiento finalizado';finishMsg.innerHTML=`<span class='ok'>Sesión guardada correctamente.</span>`;document.querySelectorAll('.save,.add,.pick,.sets input').forEach(x=>x.disabled=true)}catch(e){finish.disabled=false;finish.textContent='Finalizar entrenamiento';finishMsg.innerHTML=`<span class='bad'>${esc(e.message)}</span>`}}
boot()</script>"""
