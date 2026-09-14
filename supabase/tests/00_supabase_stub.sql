-- Emula o mínimo do Supabase para rodar as migrations num Postgres comum.
-- NÃO faz parte das migrations — é só andaime de teste.
-- As colunas de auth.users espelham as do projeto hospedado nos pontos que o
-- seed toca, para o teste local não ser mais permissivo que a realidade.

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
