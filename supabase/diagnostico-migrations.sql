-- Vote Play — o SQL das 4 migrations novas rodou mesmo?
--
-- Cole no SQL Editor do painel:
--   https://supabase.com/dashboard/project/pxgikmjtushirdbivvlb/sql/new
--
-- Isso não pergunta ao histórico de migrations; pergunta ao SCHEMA. É a
-- diferença entre "a CLI acha que aplicou" e "o banco tem".

select
  -- 20260915170000: tick_rounds passou a filtrar por auth.uid()
  (select count(*) = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tick_rounds'
      and pg_get_functiondef(p.oid) like '%v_uid%')            as "1_tick_escopado",

  -- 20260915171000: índice novo cobrindo rascunho (o antigo se chamava
  -- shows_join_code_active)
  (to_regclass('public.shows_join_code_claimed') is not null)  as "2_indice_join_code",
  (to_regclass('public.shows_join_code_active')  is null)      as "2b_indice_antigo_sumiu",

  -- 20260915172000: check que limita free_votes_per_round a 0..1
  (select count(*) = 1 from pg_constraint
    where conname = 'shows_free_votes_per_round_range')        as "3_check_voto_gratis",

  -- 20260915173000: expire_stale_payments reescrita com CTEs
  (select count(*) = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'expire_stale_payments'
      and pg_get_functiondef(p.oid) like '%pedidos as%')       as "4_expire_corrigida";

-- O que o histórico de migrations DIZ que foi aplicado (últimas 8)
select version, name
  from supabase_migrations.schema_migrations
 order by version desc
 limit 8;

-- E o seed: os três shows de demonstração existem?
select join_code, title, vote_mode, status
  from public.shows
 where join_code in ('PAGAR1', 'GRAM99', 'FREE01')
 order by join_code;
