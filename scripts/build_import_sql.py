"""Genera SQL de importación desde la exportación portable de Supabase.

Uso: python scripts/build_import_sql.py "<carpeta Datos historicos>" <carpeta_salida>

El SQL generado contiene datos personales: NO se commitea (ver .gitignore).
Preserva los IDs originales, normaliza day_code ("Upper%20A" -> "Upper A") y
resetea las secuencias. Omite created_at de las series (se completa con now()).
"""
import json
import pathlib
import sys
from urllib.parse import unquote

ORDER = [
    'exercises', 'routine_templates', 'routine_exercises', 'workout_sessions', 'workout_sets',
    'garmin_strength_imports', 'garmin_strength_sets', 'body_weight_records', 'dashboard_goals',
    'daily_health', 'garmin_daily_validated',
]
SEQUENCES = {'routine_exercises', 'workout_sets', 'garmin_strength_sets'}
SKIP_COLUMNS = {'workout_sets': {'created_at'}}
ARRAY_COLUMNS = {'secondary_muscles', 'muscles_primary', 'muscles_secondary'}


def lit(value, column):
    if value is None:
        return 'null'
    if column in ARRAY_COLUMNS:
        items = ','.join("'" + str(v).replace("'", "''") + "'" for v in value)
        return f"array[{items}]::text[]"
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def clean_raw(value):
    """Quita nulos y campos unknown_* del JSON crudo de Garmin (no aportan información)."""
    if isinstance(value, dict):
        return {k: clean_raw(v) for k, v in value.items() if v is not None and not k.startswith('unknown_')}
    if isinstance(value, list):
        return [clean_raw(v) for v in value]
    return value


def main():
    src = pathlib.Path(sys.argv[1]) / 'supabase_json'
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for i, table in enumerate(ORDER):
        rows = json.load(open(src / f'{table}.json', encoding='utf-8'))
        if not rows:
            continue
        if table == 'routine_exercises':
            for r in rows:
                r['day_code'] = unquote(r['day_code']).strip()
        if table == 'garmin_strength_imports':
            for r in rows:
                r['raw_json'] = clean_raw(r.get('raw_json'))
        skip = SKIP_COLUMNS.get(table, set())
        cols = [c for c in rows[0].keys() if c not in skip and any(r.get(c) is not None for r in rows)]
        # Columnas UUID repetidas (sesión, ejercicio...) se comprimen como índice a un array.
        uuids = []
        compact = [c for c in cols if c != 'id' and c.endswith('_id')
                   and len({r.get(c) for r in rows}) * 3 < len(rows)]
        if compact:
            uuids = sorted({r.get(c) for r in rows for c in compact if r.get(c)})
            pos = {u: i + 1 for i, u in enumerate(uuids)}
            def cell(r, c):
                if c in compact:
                    return str(pos[r[c]]) if r.get(c) else 'null'
                return lit(r.get(c), c)
            values = ',\n'.join('(' + ','.join(cell(r, c) for c in cols) + ')' for r in rows)
            sel = ','.join(f'k.u[v.{c}]' if c in compact else (f'v.{c}::uuid' if c.endswith('_id') else f'v.{c}') for c in cols)
            arr = ','.join(f"'{u}'" for u in uuids)
            sql = (f"insert into public.{table} ({','.join(cols)}) select {sel} from (values\n{values}\n)"
                   f" v({','.join(cols)}) cross join (select array[{arr}]::uuid[] u) k;\n")
        else:
            values = ',\n'.join('(' + ','.join(lit(r.get(c), c) for c in cols) + ')' for r in rows)
            sql = f"insert into public.{table} ({','.join(cols)}) values\n{values};\n"
        if table in SEQUENCES:
            sql += f"select setval(pg_get_serial_sequence('public.{table}','id'), (select max(id) from public.{table}));\n"
        (out / f'{i:02d}_{table}.sql').write_text(sql, encoding='utf-8')
        print(f'{table}: {len(rows)} filas, {len(sql)} bytes')


if __name__ == '__main__':
    main()
