-- Vote Play — `expire_stale_payments()` passa a contar o que o nome promete.
--
-- Dois defeitos na versão anterior, os dois silenciosos:
--
-- 1. `get diagnostics v_count = row_count` vinha depois do UPDATE em `votes`,
--    então a função devolvia "quantos VOTOS caíram", não "quantos PAGAMENTOS
--    expiraram". Uma cobrança de pedido direto expirando não contava nada, e o
--    log do cron mostrava 0 num minuto em que houve expiração.
--
-- 2. O UPDATE em `direct_requests` filtrava por
--    `payment_id in (select id from payments where status = 'expired')` —
--    TODOS os pagamentos já expirados na história do banco, não os desta
--    passada. É idempotente (o filtro `status = 'pending_payment'` segura),
--    mas é uma varredura crescente rodando a cada minuto para sempre.
--
-- Correção: um statement só, com CTEs que modificam dados. O Postgres executa
-- toda CTE de escrita exatamente uma vez e até o fim, referenciada ou não, e
-- todas enxergam o MESMO snapshot — então `expired` é o lote desta execução, e
-- só dele.

create or replace function expire_stale_payments() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  with expired as (
    update payments set status = 'expired'
     where status in ('created', 'pending')
       and expires_at is not null
       and expires_at <= now()
    returning id
  ),
  votos as (
    update votes set status = 'expired'
     where payment_id in (select id from expired)
       and status = 'pending'
    returning 1
  ),
  pedidos as (
    update direct_requests set status = 'refunded'
     where status = 'pending_payment'
       and payment_id in (select id from expired)
    returning 1
  )
  select count(*)::int into v_count from expired;

  return v_count;
end $$;

comment on function expire_stale_payments() is
  'Cobranças vencidas viram expired e derrubam junto o voto pendente e o '
  'pedido direto não pago. Devolve quantos PAGAMENTOS expiraram nesta passada.';

grant execute on function expire_stale_payments() to service_role;
