-- Vote Play — diagnóstico do projeto no Supabase.
-- Cole no SQL Editor. Mostra o que existe DE VERDADE ao lado do que o histórico
-- de migrations acha que foi aplicado. Quando os dois discordam, o `db push`
-- falha com "relation ... already exists".
--
-- Somente leitura: não altera nada.

-- Funções temporárias porque `cron.job` e `supabase_migrations` podem não existir,
-- e uma consulta direta a uma tabela ausente falharia já na análise da query.
create or replace function pg_temp.vp_scalar(p_sql text, p_fallback text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, p_fallback);
exception when others then
  return p_fallback;
end $$;

select * from (values
  ('1. tabelas em public', (
     select coalesce(string_agg(tablename, ', ' order by tablename), '(nenhuma)')
       from pg_tables where schemaname = 'public')),

  ('2. enums do domínio', (
     select coalesce(string_agg(t.typname, ', ' order by t.typname), '(nenhum)')
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e')),

  ('3. migrations registradas', pg_temp.vp_scalar(
     'select string_agg(version, '', '' order by version) from supabase_migrations.schema_migrations',
     '(nenhuma — o push vai tentar aplicar tudo)')),

  ('4. agendamentos pg_cron', pg_temp.vp_scalar(
     'select string_agg(jobname, '', '') from cron.job where jobname like ''vote-play-%''',
     '(nenhum ou pg_cron inativo)')),

  ('5. tabelas no Realtime', pg_temp.vp_scalar(
     'select string_agg(tablename, '', '' order by tablename) from pg_publication_tables where pubname = ''supabase_realtime''',
     '(publicação ausente)')),

  ('6. políticas de RLS', (
     select count(*)::text from pg_policies where schemaname = 'public')),

  ('7. tabelas SEM RLS', (
     select coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma (correto)')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity))
) as t(verificacao, resultado);
