-- Vote Play — tick_rounds() para de estourar na mão do artista.
--
-- Sintoma latente (nunca visto porque a função não era chamada pelo app):
-- `tick_rounds()` está concedida a `authenticated` justamente para o painel
-- poder fazer a rodada andar quando o pg_cron estiver fora. Só que ela varria
-- as rodadas de TODOS os shows e chamava `close_round_voting`/`settle_round`,
-- que fazem `assert_show_owner`. Com um artista logado, `auth.uid()` não é
-- nulo — então a primeira rodada de OUTRO artista levantava
-- "este show não pertence a você" e a batida inteira morria.
--
-- Ou seja: a rede de segurança funcionaria enquanto houvesse um artista só no
-- banco, e falharia calada a partir do segundo. Exatamente o tipo de bug que
-- aparece no dia do show do cliente.
--
-- Correção: a varredura enxerga o que o chamador tem direito de tocar.
--   • `auth.uid()` nulo  → service_role ou pg_cron: varre o banco inteiro.
--   • `auth.uid()` presente → artista: varre só os shows dele.
--
-- É a mesma regra que `assert_show_owner` já aplicava, só que aplicada na
-- SELEÇÃO em vez de na explosão. O artista continua sem poder mexer em show
-- alheio; ele apenas deixa de ser interrompido por isso.

create or replace function tick_rounds() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_touched int := 0;
begin
  -- votação encerrada no horário
  for v_id in
    select r.id
      from rounds r
      join shows s on s.id = r.show_id
     where r.status = 'open'
       and r.closes_at <= now()
       and (v_uid is null or s.owner_id = v_uid)
     order by r.closes_at
  loop
    perform close_round_voting(v_id);
    v_touched := v_touched + 1;
  end loop;

  -- apura o que já pode ser apurado
  for v_id in
    select r.id
      from rounds r
      join shows s on s.id = r.show_id
     where r.status = 'closing'
       and (v_uid is null or s.owner_id = v_uid)
     order by r.closed_at nulls first
  loop
    perform settle_round(v_id);
    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end $$;

comment on function tick_rounds() is
  'Fecha a votação no horário e apura o que já pode ser apurado. Chamada pelo '
  'pg_cron (varre tudo) e pelo painel do artista (varre só os shows dele).';

grant execute on function tick_rounds() to authenticated, service_role;
