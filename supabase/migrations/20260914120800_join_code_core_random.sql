-- Vote Play — tira o gerador de códigos da dependência de extensão.
--
-- Sintoma: "function gen_random_bytes(integer) does not exist" ao criar show.
--
-- Causa: o Supabase instala extensões no schema `extensions`, não no `public`.
-- A migration anterior fixou `search_path = public` nas funções SECURITY DEFINER
-- (correto, evita sequestro de search_path), e com isso o pgcrypto sumiu do
-- alcance. Em Postgres comum o pgcrypto costuma ficar no `public`, então o
-- ambiente de teste não reproduzia.
--
-- Correção: parar de depender de extensão. `gen_random_uuid()` é do núcleo do
-- Postgres desde a 13, vive em pg_catalog (sempre no search_path) e usa a mesma
-- fonte de aleatoriedade forte. Extrair bytes dela dá exatamente o que
-- precisávamos, sem superfície de configuração.

create or replace function generate_join_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes  bytea;
  code     text;
  attempt  int := 0;
begin
  loop
    -- 16 bytes de aleatoriedade forte, sem pgcrypto
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

    code := '';
    for i in 0..5 loop
      -- o alfabeto tem exatamente 32 símbolos, então o módulo não enviesa
      code := code || substr(alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;

    exit when not exists (
      select 1 from shows
       where join_code = code
         and status in ('ready', 'live', 'paused')
    );

    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'não foi possível gerar um código de show livre após % tentativas', attempt;
    end if;
  end loop;
  return code;
end $$;

-- Toda função SECURITY DEFINER passa a enxergar `extensions` também. Elas ignoram
-- a RLS por definição, então o search_path precisa ser fixo (nunca herdado do
-- chamador) — mas fixo DEMAIS escondia o pgcrypto. Aplicado de uma vez para não
-- depender de lembrar disso em cada função nova.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;
