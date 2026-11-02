import io
from fitparse import FitFile
from flask import jsonify, request

import app_core
from fit_folder import app
import garmin_parser


def reprocess_wellness_fixed(limit=500):
    rows=app_core.select(
        'garmin_fit_files',
        f"select=file_sha256,filename,storage_path,folder_date,status&filename=like.*_WELLNESS.fit&order=folder_date.asc,filename.asc&limit={int(limit)}"
    )
    try:
        validated_rows=app_core.select('garmin_daily_validated','select=date,steps&order=date.asc&limit=5000')
        validated={str(r.get('date')):r.get('steps') for r in validated_rows if r.get('date') and r.get('steps') is not None}
    except Exception:
        validated={}

    errors=[];processed=0;merged={};folder_days=set()
    for row in rows:
        folder_day=str(row.get('folder_date') or '')[:10]
        if folder_day:
            folder_days.add(folder_day)
        try:
            data=garmin_parser._download_fit(row['storage_path'])
            messages=list(FitFile(io.BytesIO(data)).get_messages())
            per_file=garmin_parser._monitoring_daily_values(messages,folder_day)
            processed+=1
            for day,vals in per_file.items():
                out=merged.setdefault(day,{'steps':None,'distance_m':None,'active_seconds':None,'active_calories':None})
                for key,val in vals.items():
                    if val is None:
                        continue
                    if out.get(key) is None or float(val)>float(out[key]):
                        out[key]=val
        except Exception as exc:
            errors.append(f"{row.get('filename')}: {exc}")

    written=0
    skipped_no_folder=[]
    for day,vals in merged.items():
        if day not in folder_days:
            skipped_no_folder.append(day)
            continue
        # Parsed FIT values are the default source. When Garmin Connect has an
        # explicitly validated daily total (imported from its CSV export), that
        # official finalized value wins for that day. This avoids preserving a
        # previously inflated DB value and also handles incomplete WELLNESS sets.
        step_value=validated.get(day)
        if step_value is None:
            step_value=garmin_parser._int(vals.get('steps'))
        garmin_parser._write_daily(
            day,
            {
                'steps':step_value,
                'distance_m':vals.get('distance_m'),
                'active_seconds':garmin_parser._int(vals.get('active_seconds')),
                'active_calories':garmin_parser._int(vals.get('active_calories')),
            },
            keep_max=False
        )
        written+=1

    return {
        'processed':processed,
        'days':written,
        'total_wellness':len(rows),
        'validated_days':len(validated),
        'skipped_no_folder':sorted(set(skipped_no_folder)),
        'errors':errors[:10]
    }


def fit_reprocess_wellness_fixed():
    try:
        limit=min(500,max(1,int(request.args.get('limit','500'))))
        return jsonify({'ok':True,**reprocess_wellness_fixed(limit)})
    except Exception as exc:
        return jsonify({'ok':False,'error':str(exc)}),500

app.view_functions['fit_reprocess_wellness']=app_core.auth(fit_reprocess_wellness_fixed)
