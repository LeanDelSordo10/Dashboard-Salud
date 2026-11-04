-- Solo pueden existir usuarios con un email de la lista app_allowed_users.
-- Es una segunda barrera además de "Allow new users to sign up" apagado en
-- Supabase Auth: aunque el registro se vuelva a activar por error, o alguien
-- llame directo a la API de Auth, la base rechaza crear cualquier otra cuenta
-- (y cambiar el email de una cuenta a uno no autorizado).
create or replace function public.only_allowed_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or not exists (select 1 from public.app_allowed_users a where a.email = lower(new.email)) then
    raise exception 'Registro deshabilitado: este email no está autorizado'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.only_allowed_users() from public, anon, authenticated;

drop trigger if exists only_allowed_users on auth.users;
create trigger only_allowed_users
  before insert or update of email on auth.users
  for each row execute function public.only_allowed_users();
