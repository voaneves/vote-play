-- Vote Play — publicação de Realtime e agendamentos.
--
-- Tudo aqui é condicional e idempotente, por dois motivos:
--   1. Estas peças só existem no Supabase; a ausência delas não pode derrubar a
--      migration num Postgres comum (CI, teste local).
--   2. São infraestrutura operacional, não schema. Um problema de agendador não
--      pode impedir o `db push` de aplicar as tabelas.
-- Se algo aqui falhar, a migration avisa e segue — e o painel do artista continua
-- chamando tick_rounds() por conta própria, que é a rede de segurança.

-- ------------------------------------------------------------------- Realtime

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publicação supabase_realtime ausente — pulando (ambiente não-Supabase)';
    return;
  end if;

  foreach v_table in array array['round_candidates', 'rounds', 'direct_requests'] loop
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      raise notice 'tabela % já está na publicação de Realtime', v_table;
    else
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------------- pg_cron
--
-- ATENÇÃO à sintaxe do agendamento. O pg_cron aceita intervalo em segundos
-- apenas de 1 a 59 ('10 seconds' vale, '60 seconds' e '1 minute' NÃO).
-- De um minuto para cima é obrigatório o cron clássico de 5 campos.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron ausente — agende tick_rounds() e expire_stale_payments() por fora';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Batida do relógio das rodadas. A precisão daqui define quanto tempo o telão
  -- fica mostrando 00:00 antes de anunciar a vencedora.
  perform cron.schedule('vote-play-tick-rounds', '10 seconds', 'select public.tick_rounds();');

  -- Cobranças vencidas, a cada minuto.
  perform cron.schedule('vote-play-expire-payments', '* * * * *', 'select public.expire_stale_payments();');

  raise notice 'pg_cron: tick_rounds a cada 10s, expire_stale_payments a cada minuto';
exception when others then
  -- Agendador é infraestrutura, não schema: avisa e deixa o push seguir.
  raise warning 'não foi possível agendar no pg_cron (%). Ative a extensão no painel e rode supabase/migrations/20260914120500_realtime_and_cron.sql de novo.', sqlerrm;
end $$;
