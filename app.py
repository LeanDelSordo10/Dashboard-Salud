import app_core
from flask import request, make_response

app_core.FIT_BUCKET = 'fit-files'

from fit_folder import app
import tredict_sync
import dashboard_ui
import weight_dashboard_patch
import tredict_dashboard_patch
import garmin_parser
import garmin_reprocess_fix
import garmin_diagnostics
import summary_day
import weight_registry
import settings_goals

UI_VERSION = '20261005-0012'

_home_view = app.view_functions.get('home')
if _home_view:
    def home_with_view_mode_fix(*args, **kwargs):
        raw = _home_view(*args, **kwargs)
        response = make_response(raw)
        if response.mimetype == 'text/html':
            html = response.get_data(as_text=True)
            html = html.replace("/static/dashboard.css?v=1", f"/static/dashboard.css?v={UI_VERSION}")
            html = html.replace("/static/dashboard.js?v=1", f"/static/dashboard.js?v={UI_VERSION}")
            html = html.replace('</head>', f"<meta name='dashboard-ui-version' content='{UI_VERSION}'><meta http-equiv='Cache-Control' content='no-cache, no-store, must-revalidate'><meta http-equiv='Pragma' content='no-cache'><meta http-equiv='Expires' content='0'><link rel='stylesheet' href='/static/view_mode_fix.css?v={UI_VERSION}'><link rel='stylesheet' href='/static/summary_day.css?v={UI_VERSION}'><link rel='stylesheet' href='/static/summary_chart_fix.css?v={UI_VERSION}'><link rel='stylesheet' href='/static/settings_goals.css?v={UI_VERSION}'><style>.session-kpis .metric-box:nth-child(2){{display:none!important}}.exercise-row summary>span:nth-of-type(2){{display:none!important}}.session-item>div:nth-child(4){{display:none!important}}</style></head>")
            html = html.replace('</body>', f"<script>window.__DASHBOARD_UI_VERSION__='{UI_VERSION}';try{{if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));if(window.caches)caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))}}catch(e){{}}</script><script src='/static/view_mode_fix.js?v={UI_VERSION}'></script><script src='/static/tredict_sync_ui.js?v={UI_VERSION}'></script><script src='/static/summary_day.js?v={UI_VERSION}'></script><script src='/static/summary_chart_fix.js?v={UI_VERSION}'></script><script src='/static/steps_calendar.js?v={UI_VERSION}'></script><script src='/static/registry_nav.js?v={UI_VERSION}'></script><script src='/static/settings_goals.js?v={UI_VERSION}'></script><script src='/static/session_muscle_patch.js?v={UI_VERSION}'></script></body>")
            response.set_data(html)
            response.content_length = len(response.get_data())
        return response
    app.view_functions['home'] = home_with_view_mode_fix


@app.after_request
def prevent_stale_dashboard_cache(response):
    p = request.path
    is_static = p.startswith('/static/')
    is_api = p.startswith('/api/')
    if p == '/' or is_static or is_api:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Surrogate-Control'] = 'no-store'
        response.headers['CDN-Cache-Control'] = 'no-store'
        response.headers['Vercel-CDN-Cache-Control'] = 'no-store'
        response.headers['Clear-Site-Data'] = '"cache"'
    return response


_gym_view = app.view_functions.get('gym')
if _gym_view:
    def gym_with_muscle_map(*args, **kwargs):
        response = _gym_view(*args, **kwargs)
        if isinstance(response, str):
            response = response.replace('Gym móvil', 'Registro de fuerza')
            response = response.replace('</body>', f"<script src='/static/gym_muscle.js?v={UI_VERSION}'></script></body>")
        return response
    app.view_functions['gym'] = gym_with_muscle_map
