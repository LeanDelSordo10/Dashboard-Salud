-- Lista de emails autorizados a usar la API. Cerrada como el resto de la base:
-- solo la Edge Function (service role) la lee. El email se carga a mano en
-- Supabase (no se versiona en el repo público):
--   insert into public.app_allowed_users (email) values ('tu-email@ejemplo.com');
create table if not exists public.app_allowed_users (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.app_allowed_users enable row level security;
alter table public.app_allowed_users force row level security;
revoke all on public.app_allowed_users from anon, authenticated;
