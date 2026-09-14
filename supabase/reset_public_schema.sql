-- Vote Play — recomeçar do zero no projeto do Supabase.
--
-- QUANDO USAR: o `supabase db push` reclama que uma tabela já existe, sinal de que
-- o histórico de migrations e o schema real discordaram (push interrompido no meio,
-- SQL colado à mão no editor, etc.).
--
-- O QUE FAZ: apaga TUDO do schema `public` e zera o histórico de migrations, para
-- que o `db push` seguinte aplique a base inteira do zero.
--
-- DESTRUTIVO. Só rode num projeto sem dados que você queira manter.
-- Não encosta em `auth`, `storage` nem nos usuários já cadastrados — esses ficam
-- em outros schemas.

begin;

drop schema if exists public cascade;
create schema public;

-- devolve o schema ao estado padrão do Supabase antes das migrations rodarem
alter schema public owner to postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- remove agendamentos antigos, se o pg_cron já estiver ativo
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname like 'vote-play-%';
  end if;
exception when others then
  raise notice 'pg_cron: nada a limpar (%)', sqlerrm;
end $$;

-- zera o histórico para o db push reaplicar tudo
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
    raise notice 'histórico de migrations zerado';
  else
    raise notice 'sem histórico de migrations (projeto novo)';
  end if;
end $$;

commit;
