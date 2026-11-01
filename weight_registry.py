from datetime import date, datetime, timezone
import requests
from flask import jsonify, request

import app_core
from fit_folder import app


def _rows(query=''):
    try:return app_core.select('body_weight_records',query)
    except Exception:return []


def _save(row):
    url=f"{app_core.SUPABASE_URL}/rest/v1/body_weight_records?on_conflict=measurement_date"
    r=requests.post(url,headers=app_core.headers({'Prefer':'resolution=merge-duplicates,return=representation'}),json=[row],timeout=20)
    r.raise_for_status();return r.json()[0]


@app.get('/api/weight-records')
@app_core.auth
def weight_records():
    limit=min(500,max(1,int(request.args.get('limit','100'))))
    return jsonify(_rows(f'select=*&order=measurement_date.desc&limit={limit}'))


@app.post('/api/weight-records')
@app_core.auth
def save_weight_record():
    data=request.get_json(silent=True) or {}
    day=str(data.get('date') or date.today().isoformat())[:10]
    try:datetime.strptime(day,'%Y-%m-%d')
    except Exception:return jsonify({'error':'Fecha inválida'}),400
    try:weight=round(float(str(data.get('weight_kg')).strip().replace(',','.')),2)
    except Exception:return jsonify({'error':'Ingresá un peso válido usando punto decimal, por ejemplo 91.4'}),400
    if not 20 < weight < 400:return jsonify({'error':'El peso debe estar entre 20 y 400 kg'}),400
    now=datetime.now(timezone.utc).isoformat()
    try:
        saved=_save({'measurement_date':day,'measured_at':now,'weight_kg':weight,'notes':str(data.get('notes') or '').strip() or None,'source':'manual','updated_at':now})
        return jsonify({'ok':True,'record':saved})
    except Exception as exc:return jsonify({'error':str(exc)}),500


WEIGHT_PAGE="""<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><title>Registro de peso corporal</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#080b0f;color:#f4f7fb;font-family:Inter,system-ui,Arial}.wrap{max-width:760px;margin:auto;padding:22px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.muted{color:#8491a1}.card{background:#10151c;border:1px solid #28323e;border-radius:16px;padding:18px;margin-top:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.label{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8fa3bd;margin-bottom:7px}input,textarea{width:100%;background:#0a0f15;border:1px solid #303b48;border-radius:10px;padding:12px;color:#fff;font:inherit}textarea{min-height:76px;resize:vertical}.btn{border:1px solid #303b48;border-radius:10px;padding:11px 14px;background:#151c24;color:#fff;font-weight:750;text-decoration:none;cursor:pointer}.primary{background:#f4254b;border-color:#f4254b}.primary:disabled{opacity:.55}.big{font-size:30px;font-weight:850}.history{display:grid;gap:8px}.row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:11px 0;border-bottom:1px solid #202833}.row:last-child{border:0}.ok{color:#47d18c;font-weight:750}.bad{color:#ff607c;font-weight:750}.save-status{min-height:22px;margin-top:10px}.save-confirm{display:none;margin-top:12px;padding:12px 14px;border:1px solid rgba(71,209,140,.4);background:rgba(71,209,140,.08);border-radius:10px;color:#6ee7a7;font-weight:750}.save-confirm.show{display:block}@media(max-width:600px){.wrap{padding:14px}.grid{grid-template-columns:1fr}.top{align-items:flex-start}.btn{min-height:46px}input{font-size:16px}}
</style></head><body><div class='wrap'><div class='top'><div><div class='muted'>REGISTRO</div><h2 style='margin:4px 0'>Peso corporal</h2><div class='muted'>Fuente oficial manual del dashboard.</div></div><a class='btn' href='/'>← Dashboard</a></div><div class='card'><div class='grid'><div><div class='label'>Fecha</div><input id='date' type='date'></div><div><div class='label'>Peso (kg)</div><input id='weight' type='text' inputmode='decimal' autocomplete='off' enterkeyhint='done' placeholder='Ej. 91.4'></div></div><div style='margin-top:12px'><div class='label'>Nota opcional</div><textarea id='notes' placeholder='Ej. medición en ayunas'></textarea></div><button class='btn primary' id='save' style='width:100%;margin-top:14px'>Guardar peso</button><div id='msg' class='save-status muted'></div><div id='confirm' class='save-confirm'></div></div><div class='card'><div class='label'>Último registro</div><div class='big' id='latest'>—</div><div class='muted' id='latestDate'>Sin mediciones todavía</div></div><div class='card'><h3 style='margin-top:0'>Historial</h3><div id='history' class='history muted'>Cargando...</div></div></div><script>
const $=id=>document.getElementById(id);$('date').value=new Date().toISOString().slice(0,10);
function fmtWeight(v){return Number(v).toLocaleString('es-AR',{minimumFractionDigits:1,maximumFractionDigits:2})+' kg'}
async function load(){try{let r=await fetch('/api/weight-records?limit=30',{cache:'no-store'}),d=await r.json();if(!Array.isArray(d))return;if(d[0]){$('latest').textContent=fmtWeight(d[0].weight_kg);$('latestDate').textContent=new Date(d[0].measurement_date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}$('history').innerHTML=d.length?d.map(x=>`<div class='row'><div><b>${new Date(x.measurement_date+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'})}</b>${x.notes?`<div class='muted'>${x.notes}</div>`:''}</div><b>${fmtWeight(x.weight_kg)}</b></div>`).join(''):'Sin mediciones todavía'}catch(e){$('history').textContent='No se pudo cargar el historial'}}
async function saveWeight(){let raw=$('weight').value.trim();$('confirm').classList.remove('show');if(!raw){$('msg').className='save-status bad';$('msg').textContent='Ingresá el peso.';$('weight').focus();return}let normalized=raw.replace(',','.');let weight=Number(normalized);if(!Number.isFinite(weight)||weight<=20||weight>=400){$('msg').className='save-status bad';$('msg').textContent='Ingresá un peso válido. Ejemplo: 91.4';return}$('save').disabled=true;$('save').textContent='Guardando…';$('msg').className='save-status muted';$('msg').textContent='Guardando en la base de datos…';try{let r=await fetch('/api/weight-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:$('date').value,weight_kg:normalized,notes:$('notes').value})}),d=await r.json();if(!r.ok)throw new Error(d.error||'No se pudo guardar');$('msg').className='save-status ok';$('msg').textContent='✓ Peso guardado correctamente';$('confirm').textContent=`${fmtWeight(d.record.weight_kg)} guardados para ${new Date(d.record.measurement_date+'T12:00:00').toLocaleDateString('es-AR')}.`;$('confirm').classList.add('show');$('weight').value='';$('notes').value='';await load()}catch(e){$('msg').className='save-status bad';$('msg').textContent='✕ '+e.message}finally{$('save').disabled=false;$('save').textContent='Guardar peso'}}
$('save').addEventListener('click',saveWeight);$('weight').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveWeight()}});load();
</script></body></html>"""


@app.get('/weight')
@app_core.auth
def weight_page():return WEIGHT_PAGE
