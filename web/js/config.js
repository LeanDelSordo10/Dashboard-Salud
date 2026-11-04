// Configuración pública del frontend.
// La clave "publishable" es pública por diseño: solo permite iniciar sesión.
// No da acceso a ningún dato: la base está cerrada y todo pasa por la API,
// que valida la sesión y el email autorizado del lado del servidor.
export const SUPABASE_URL = 'https://yqqpdmqykcdwqovbnato.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5D3Qy6ys8C2CrbUnEF7z-A_WwgaGpYh';
export const API_URL = `${SUPABASE_URL}/functions/v1/api`;
export const APP_VERSION = '2026.11.04';
