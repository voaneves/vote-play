-- Vote Play — triggers

create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger shows_updated_at before update on shows
  for each row execute function set_updated_at();
create trigger payments_updated_at before update on payments
  for each row execute function set_updated_at();

create trigger shows_join_code before insert on shows
  for each row execute function shows_default_join_code();

/**
 * Contabilização do voto. Fica SÓ aqui — nunca na Edge Function — para que o
 * caminho pago (webhook) e o grátis somem pelos mesmos contadores, e para que
 * não exista instante em que o voto está confirmado e o placar ainda não sabe.
 * Roda na mesma transação que confirma o voto.
 */
create or replace function apply_vote_to_tally() returns trigger
language plpgsql as $$
declare
  v_delta_weight bigint := 0;
  v_delta_amount bigint := 0;
  v_delta_votes  int := 0;
  v_was          boolean := (tg_op = 'UPDATE' and old.status = 'confirmed');
  v_is           boolean := (new.status = 'confirmed');
begin
  if v_is and not v_was then
    v_delta_weight := new.weight;
    v_delta_amount := new.amount_cents;
    v_delta_votes  := 1;
  elsif v_was and not v_is then
    -- estorno ou anulação: desfaz exatamente o que somou
    v_delta_weight := -old.weight;
    v_delta_amount := -old.amount_cents;
    v_delta_votes  := -1;
  else
    return new;
  end if;

  update round_candidates
     set weight        = weight + v_delta_weight,
         amount_cents  = amount_cents + v_delta_amount,
         votes_count   = votes_count + v_delta_votes,
         first_vote_at = case
           when v_delta_votes > 0
             then least(coalesce(first_vote_at, 'infinity'::timestamptz),
                        coalesce(new.confirmed_at, now()))
           else first_vote_at
         end
   where id = new.candidate_id;

  update rounds
     set total_weight       = total_weight + v_delta_weight,
         total_amount_cents = total_amount_cents + v_delta_amount,
         total_votes        = total_votes + v_delta_votes
   where id = new.round_id;

  return new;
end $$;

create trigger votes_apply_tally
  after insert or update of status on votes
  for each row execute function apply_vote_to_tally();

/**
 * Trava de segurança no próprio banco: nenhum voto entra numa rodada já apurada,
 * qualquer que seja o caminho — Edge Function, SQL Editor ou engano futuro.
 */
create or replace function guard_vote_round_open() returns trigger
language plpgsql as $$
declare v_status round_status;
begin
  select status into v_status from rounds where id = new.round_id;
  if v_status not in ('open', 'closing') then
    raise exception 'não é possível registrar voto em rodada com status %', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if v_status = 'closing' and new.status = 'pending' then
    raise exception 'a votação desta rodada já encerrou'
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $$;

create trigger votes_guard_round before insert on votes
  for each row execute function guard_vote_round_open();
