import os
import re
import hashlib
import requests
from flask import request, jsonify
import app_core
from gym_flow import app

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _safe_part(value):
    value = (value or '').strip().replace('\\', '/')
    value = re.sub(r'[^A-Za-z0-9._() -]+', '_', value)
    value = value.strip(' .')
    return value or 'sin-nombre'


def _clean_relative_path(raw_name):
    raw = (raw_name or '').replace('\\', '/')
    parts = [p for p in raw.split('/') if p and p not in ('.', '..')]
    if not parts:
        return 'archivo.fit', [], None
    inside = parts[1:] if len(parts) > 1 else parts
    safe = [_safe_part(p) for p in inside]
    folder_date = next((p for p in inside if DATE_RE.match(p)), None)
    return '/'.join(safe), parts, folder_date


def _storage_upload(path, data):
    r = requests.post(
        f'{app_core.SUPABASE_URL}/storage/v1/object/{app_core.FIT_BUCKET}/{path}',
        headers={
            'apikey': app_core.SUPABASE_KEY,
            'Authorization': f'Bearer {app_core.SUPABASE_KEY}',
            'Content-Type': 'application/octet-stream',
        },
        data=data,
        timeout=40,
    )
    if r.ok:
        return 'uploaded'
    body = (r.text or '').lower()
    if r.status_code in (400, 409) and ('duplicate' in body or 'already exists' in body or 'resource already exists' in body):
        return 'exists'
    r.raise_for_status()
    return 'uploaded'


def _register_fit_best_effort(sha, rel_path, original_parts, storage_path, data_len, folder_date):
    try:
        app_core.insert('garmin_fit_files', [{
            'file_sha256': sha,
            'filename': os.path.basename(rel_path),
            'relative_path': '/'.join(original_parts),
            'storage_path': storage_path,
            'file_size': data_len,
            'folder_date': folder_date,
            'status': 'uploaded',
        }], False)
        return True
    except Exception:
        return False


def fit_status():
    try:
        rows = app_core.select('garmin_fit_files', 'select=filename,folder_date,uploaded_at,status&order=uploaded_at.desc&limit=5000')
        dates = sorted({str(r.get('folder_date')) for r in rows if r.get('folder_date')})
        latest_upload = rows[0].get('uploaded_at') if rows else None
        return jsonify({
            'ok': True,
            'files': len(rows),
            'days': len(dates),
            'first_date': dates[0] if dates else None,
            'last_date': dates[-1] if dates else None,
            'latest_upload': latest_upload,
        })
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


def fit_page_folder():
    body = """
    <div class='wrap'>
      <div class='top'>
        <div><h2>Sincronizar Historial Garmin</h2><div class='muted'>La base cargada queda guardada en la nube. Solo sincronizá cuando agregues nuevos FIT a tu carpeta.</div></div>
        <a class='btn alt' href='/'>Dashboard</a>
      </div>

      <div class='card' id='storedCard'>
        <div class='label'>Base Garmin guardada</div>
        <div id='storedStatus' class='muted' style='margin-top:10px'>Consultando base...</div>
      </div>

      <div class='card'>
        <div class='label'>Sincronizar cambios desde tu PC</div>
        <h3 style='margin:8px 0 4px'>Historial Garmin</h3>
        <div class='muted' style='line-height:1.5'>No hace falta volver a cargar nada si no hubo cambios. Cuando tengas FIT nuevos, seleccioná la carpeta raíz completa y el sistema incorporará solamente los que falten.</div>

        <label class='btn' for='folder' style='display:inline-block;margin-top:16px'>Seleccionar carpeta Historial Garmin</label>
        <input id='folder' type='file' webkitdirectory directory multiple style='display:none'>

        <div id='preview' style='margin-top:16px'></div>
        <button class='btn' id='sync' style='margin-top:12px;display:none'>Sincronizar cambios</button>
        <div id='progressWrap' style='display:none;margin-top:14px'>
          <div style='height:9px;background:#202630;border-radius:99px;overflow:hidden'><div id='progressBar' style='height:100%;width:0;background:#ed1939;transition:.2s'></div></div>
          <div class='muted' id='progressText' style='font-size:12px;margin-top:7px'></div>
        </div>
        <div id='result' style='margin-top:14px'></div>
      </div>

      <div class='card muted' style='font-size:13px;line-height:1.55'>
        Los FIT ya sincronizados quedan guardados en Supabase aunque cierres o actualices esta página. La selección de la carpeta local no puede mantenerse después de cerrar el navegador por seguridad del navegador; solo necesitás volver a seleccionarla cuando quieras buscar archivos nuevos.
      </div>
    </div>
    <script>
    const folder=document.getElementById('folder'),preview=document.getElementById('preview'),sync=document.getElementById('sync'),result=document.getElementById('result'),progressWrap=document.getElementById('progressWrap'),progressBar=document.getElementById('progressBar'),progressText=document.getElementById('progressText'),storedStatus=document.getElementById('storedStatus');
    let fitFiles=[];
    const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

    async function loadStoredStatus(){
      try{
        const r=await fetch('/api/fit/status'),d=await r.json();
        if(!r.ok)throw new Error(d.error||'Error');
        if(!d.files){storedStatus.innerHTML='<span class="muted">Todavía no hay FIT indexados en la base.</span>';return}
        const range=(d.first_date||d.last_date)?`<div class="muted" style="margin-top:8px">Desde ${d.first_date||'—'} hasta ${d.last_date||'—'}</div>`:'';
        storedStatus.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"><div class="kpi"><div class="label">FIT guardados</div><div class="big">${d.files}</div></div><div class="kpi"><div class="label">Días guardados</div><div class="big">${d.days}</div></div><div class="kpi"><div class="label">Estado</div><div style="font-weight:900;margin-top:7px;color:#7ee787">Base persistente ✓</div></div></div>${range}`;
      }catch(e){storedStatus.innerHTML=`<span class="bad">No se pudo consultar la base: ${esc(e.message)}</span>`}
    }
    loadStoredStatus();

    folder.addEventListener('change',()=>{
      fitFiles=[...folder.files].filter(f=>f.name.toLowerCase().endsWith('.fit'));
      const all=[...folder.files];
      const roots=[...new Set(all.map(f=>(f.webkitRelativePath||f.name).split('/')[0]).filter(Boolean))];
      const days=[...new Set(fitFiles.map(f=>{const m=(f.webkitRelativePath||'').match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\/|$)/);return m?m[1]:null}).filter(Boolean))].sort();
      preview.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px"><div class="kpi"><div class="label">Carpeta</div><div style="font-weight:800;margin-top:5px">${esc(roots[0]||'—')}</div></div><div class="kpi"><div class="label">Archivos FIT encontrados</div><div class="big">${fitFiles.length}</div></div><div class="kpi"><div class="label">Días detectados</div><div class="big">${days.length}</div></div></div>${fitFiles.length?`<div class="muted" style="margin-top:10px">Desde ${days[0]||'—'} hasta ${days.at(-1)||'—'}</div>`:'<div class="bad" style="margin-top:10px">No se encontraron archivos .FIT en la carpeta seleccionada.</div>'}`;
      sync.style.display=fitFiles.length?'inline-block':'none'; result.innerHTML='';
    });

    sync.onclick=async()=>{
      if(!fitFiles.length)return;
      sync.disabled=true;folder.disabled=true;progressWrap.style.display='block';result.innerHTML='';
      const batchSize=20;let processed=0,added=0,dupes=0,failed=0,days=new Set(),details=[];
      try{
        for(let i=0;i<fitFiles.length;i+=batchSize){
          const batch=fitFiles.slice(i,i+batchSize),fd=new FormData();
          batch.forEach(f=>fd.append('files',f,f.webkitRelativePath||f.name));
          const r=await fetch('/api/fit/upload',{method:'POST',body:fd});
          const d=await r.json();
          if(!r.ok)throw new Error(d.error||'Error al cargar FIT');
          added+=d.new_files||0;dupes+=d.duplicates||0;failed+=d.failed||0;(d.days||[]).forEach(x=>days.add(x));if(d.errors)details.push(...d.errors);
          processed+=batch.length;const p=Math.round(processed*100/fitFiles.length);progressBar.style.width=p+'%';progressText.textContent=`${processed} de ${fitFiles.length} archivos revisados`;
        }
        result.innerHTML=`<div class="card" style="margin:0;background:#0d1511;border-color:#28523f"><div style="font-weight:900;font-size:17px">✓ Sincronización completada</div><div style="margin-top:9px;line-height:1.7">${fitFiles.length} archivos FIT revisados<br><b>${added}</b> archivos nuevos incorporados<br><b>${dupes}</b> ya estaban guardados<br><b>${days.size}</b> días revisados${failed?`<br><span class="bad"><b>${failed}</b> con error</span>`:''}</div></div>${details.length?`<div class="bad" style="margin-top:10px">${details.slice(0,5).map(esc).join('<br>')}</div>`:''}`;
        await loadStoredStatus();
      }catch(e){result.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
      finally{sync.disabled=false;folder.disabled=false}
    };
    </script>
    """
    return app_core.page(body, 'Sincronizar Garmin FIT')


def upload_folder():
    try:
        new_files = 0
        duplicates = 0
        failed = 0
        days = set()
        errors = []

        for f in request.files.getlist('files'):
            if not (f.filename or '').lower().endswith('.fit'):
                continue
            try:
                data = f.read()
                sha = hashlib.sha256(data).hexdigest()
                rel_path, original_parts, folder_date = _clean_relative_path(f.filename)
                if folder_date:
                    days.add(folder_date)
                storage_path = f'historial-garmin/{rel_path}'

                try:
                    existing = app_core.select('garmin_fit_files', f'select=id,storage_path&file_sha256=eq.{sha}&limit=1')
                except Exception:
                    existing = []
                if existing:
                    duplicates += 1
                    continue

                storage_state = _storage_upload(storage_path, data)
                if storage_state == 'exists':
                    duplicates += 1
                    _register_fit_best_effort(sha, rel_path, original_parts, storage_path, len(data), folder_date)
                    continue

                _register_fit_best_effort(sha, rel_path, original_parts, storage_path, len(data), folder_date)
                new_files += 1
            except Exception as exc:
                failed += 1
                errors.append(f'{os.path.basename(f.filename or "archivo.fit")}: {exc}')

        return jsonify({
            'ok': True,
            'new_files': new_files,
            'duplicates': duplicates,
            'failed': failed,
            'days': sorted(days),
            'errors': errors,
        })
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


app.view_functions['fit_page'] = app_core.auth(fit_page_folder)
app.view_functions['upload'] = app_core.auth(upload_folder)
app.add_url_rule('/api/fit/status', 'fit_status', app_core.auth(fit_status), methods=['GET'])
