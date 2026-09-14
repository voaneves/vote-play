-- Vote Play — funções de domínio.
-- Regra: toda decisão sobre dinheiro e apuração vive AQUI, nunca no cliente.

-- ---------------------------------------------------------------- utilitários

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

/**
 * Código de entrada do show: 6 caracteres do alfabeto Crockford sem I, L, O e U.
 * Usa gen_random_bytes (não random()) para que ninguém consiga adivinhar ou
 * enumerar os códigos dos shows que estão acontecendo agora.
 * O alfabeto tem exatamente 32 símbolos, então o módulo não introduz viés.
 */
create or replace function generate_join_code() returns text
language plpgsql as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  code     text;
  attempt  int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
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

create or replace function shows_default_join_code() returns trigger
language plpgsql as $$
begin
  if new.join_code is null or btrim(new.join_code) = '' then
    new.join_code := generate_join_code();
  else
    new.join_code := upper(btrim(new.join_code));
  end if;
  return new;
end $$;

/**
 * Peso do voto. ESTA é a única fonte da regra — a versão em TypeScript
 * (previewVoteWeight) serve apenas para prever a UI e não tem valor legal.
 */
create or replace function compute_vote_weight(p_show_id uuid, p_amount_cents int)
returns int language plpgsql stable as $$
declare
  v_mode  vote_mode;
  v_ratio int;
begin
  select vote_mode, cents_per_point into v_mode, v_ratio
    from shows where id = p_show_id;

  if not found then
    raise exception 'show % não encontrado', p_show_id using errcode = 'no_data_found';
  end if;

  if v_mode = 'free_with_tip' then return 1; end if;
  if p_amount_cents <= 0 then return 1; end if;

  return greatest(1, (p_amount_cents / greatest(1, v_ratio))::int);
end $$;

/**
 * Guarda de propriedade para as funções SECURITY DEFINER do painel.
 * Elas ignoram a RLS por definição, então a checagem precisa ser explícita —
 * senão qualquer artista autenticado mexeria no show de outro.
 * auth.uid() nulo = service_role ou pg_cron, que já são confiáveis.
 */
create or replace function assert_show_owner(p_show_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  select owner_id into v_owner from shows where id = p_show_id;
  if v_owner is distinct from v_uid then
    raise exception 'este show não pertence a você' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ------------------------------------------------------------------- rodadas

/**
 * Abre uma rodada com as candidatas que o ARTISTA escolheu (decisão nº 4).
 * Recusa se já existir rodada ativa: o painel precisa apurar a anterior antes.
 */
create or replace function open_round(
  p_show_id          uuid,
  p_song_ids         uuid[],
  p_duration_seconds int  default null,
  p_label            text default null
) returns rounds
language plpgsql security definer set search_path = public as $$
declare
  v_show     shows;
  v_round    rounds;
  v_duration int;
  v_seq      int;
  v_count    int;
begin
  perform assert_show_owner(p_show_id);

  select * into v_show from shows where id = p_show_id for update;
  if not found then
    raise exception 'show % não encontrado', p_show_id using errcode = 'no_data_found';
  end if;
  if v_show.status <> 'live' then
    raise exception 'o show precisa estar no ar para abrir uma rodada (status atual: %)', v_show.status
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from rounds where show_id = p_show_id and status in ('open', 'closing')) then
    raise exception 'já existe uma rodada ativa neste show; apure a anterior primeiro'
      using errcode = 'unique_violation';
  end if;

  v_count := coalesce(array_length(p_song_ids, 1), 0);
  if v_count < 2 or v_count > 8 then
    raise exception 'uma rodada precisa de 2 a 8 candidatas (recebidas: %)', v_count
      using errcode = 'invalid_parameter_value';
  end if;

  v_duration := coalesce(p_duration_seconds, v_show.round_duration_seconds);
  select coalesce(max(seq), 0) + 1 into v_seq from rounds where show_id = p_show_id;

  insert into rounds (show_id, seq, label, status, opens_at, closes_at, settle_by)
  values (
    p_show_id, v_seq, p_label, 'open', now(),
    now() + make_interval(secs => v_duration),
    now() + make_interval(secs => v_duration + v_show.settlement_grace_seconds)
  )
  returning * into v_round;

  insert into round_candidates (round_id, show_song_id, title, artist_name, position)
  select v_round.id, ss.id, s.title, s.artist_name,
         row_number() over (order by array_position(p_song_ids, ss.song_id))
    from show_songs ss
    join songs s on s.id = ss.song_id
   where ss.show_id = p_show_id
     and ss.song_id = any (p_song_ids)
     and ss.status in ('available', 'candidate');

  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_song_ids, 1), 0) then
    raise exception 'alguma música não pertence ao repertório deste show ou já foi tocada'
      using errcode = 'foreign_key_violation';
  end if;

  update show_songs set status = 'candidate'
   where show_id = p_show_id and song_id = any (p_song_ids);

  insert into show_events (show_id, actor, type, payload)
  values (p_show_id, 'artist', 'round_opened',
          jsonb_build_object('round_id', v_round.id, 'seq', v_seq, 'candidates', v_count));

  return v_round;
end $$;

/**
 * Encerra a VOTAÇÃO (não a apuração). A rodada entra em 'closing' e passa a
 * recusar novos votos, enquanto os Pix já emitidos terminam de resolver.
 */
create or replace function close_round_voting(p_round_id uuid)
returns rounds
language plpgsql security definer set search_path = public as $$
declare v_round rounds;
begin
  perform assert_show_owner((select show_id from rounds where id = p_round_id));

  update rounds
     set status = 'closing', closed_at = now()
   where id = p_round_id and status = 'open'
  returning * into v_round;

  if not found then
    select * into v_round from rounds where id = p_round_id;
    if not found then
      raise exception 'rodada % não encontrada', p_round_id using errcode = 'no_data_found';
    end if;
    return v_round;
  end if;

  insert into show_events (show_id, actor, type, payload)
  values (v_round.show_id, 'system', 'round_voting_closed',
          jsonb_build_object('round_id', v_round.id));

  return v_round;
end $$;

/**
 * Apura e elege a vencedora.
 * Desempate (decisão nº 3): maior peso; empatou, vence quem recebeu o primeiro
 * voto confirmado; persistindo o empate, a ordem em que o artista listou.
 *
 * Só apura quando não há mais voto pendente — ou quando a janela de carência
 * (settle_by) estourou, e aí os pendentes viram 'voided'. Como o QR Pix expira
 * antes de settle_by, na prática não sobra dinheiro pago sem voto contado.
 */
create or replace function settle_round(p_round_id uuid, p_force boolean default false)
returns rounds
language plpgsql security definer set search_path = public as $$
declare
  v_round   rounds;
  v_pending int;
  v_winner  round_candidates;
begin
  perform assert_show_owner((select show_id from rounds where id = p_round_id));

  select * into v_round from rounds where id = p_round_id for update;
  if not found then
    raise exception 'rodada % não encontrada', p_round_id using errcode = 'no_data_found';
  end if;
  if v_round.status = 'settled' then
    return v_round;  -- idempotente
  end if;
  if v_round.status not in ('open', 'closing') then
    raise exception 'rodada % não pode ser apurada (status %)', p_round_id, v_round.status
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_pending from votes where round_id = p_round_id and status = 'pending';

  if v_pending > 0 and not p_force and now() < v_round.settle_by then
    return v_round;  -- ainda dentro da carência: espera o Pix resolver
  end if;

  -- Carência estourada: o que não pagou não conta. O QR correspondente já expirou.
  if v_pending > 0 then
    update votes set status = 'voided' where round_id = p_round_id and status = 'pending';
  end if;

  select * into v_winner
    from round_candidates
   where round_id = p_round_id
   order by weight desc, first_vote_at asc nulls last, position asc
   limit 1;

  update rounds
     set status = 'settled',
         settled_at = now(),
         closed_at = coalesce(closed_at, now()),
         winner_candidate_id = v_winner.id
   where id = p_round_id
  returning * into v_round;

  -- a vencedora entra na fila do show; as demais voltam a ficar disponíveis
  update show_songs set status = 'available'
   where id in (select show_song_id from round_candidates where round_id = p_round_id)
     and status = 'candidate';

  if v_winner.id is not null then
    update show_songs set status = 'queued' where id = v_winner.show_song_id;
  end if;

  insert into show_events (show_id, actor, type, payload)
  values (v_round.show_id, 'system', 'round_settled',
          jsonb_build_object(
            'round_id', v_round.id,
            'winner', v_winner.title,
            'weight', v_winner.weight,
            'voided_votes', v_pending));

  return v_round;
end $$;

/**
 * Batida do relógio. Chamada por pg_cron e também pelo painel do artista,
 * para não depender de um único mecanismo durante o show.
 */
create or replace function tick_rounds() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_touched int := 0;
begin
  -- votação encerrada no horário
  for v_id in
    select id from rounds where status = 'open' and closes_at <= now()
  loop
    perform close_round_voting(v_id);
    v_touched := v_touched + 1;
  end loop;

  -- apura o que já pode ser apurado
  for v_id in
    select id from rounds where status = 'closing'
  loop
    perform settle_round(v_id);
    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end $$;

-- ---------------------------------------------------------------- pagamentos

/**
 * Validade do QR Pix de um voto.
 *
 * É aqui que a decisão "não deixar o Pix confirmar depois da apuração" vira
 * garantia técnica: o QR nunca vive além da janela de apuração da rodada.
 * Quem gerar o código faltando 10 segundos recebe um QR de 10s + carência,
 * e vê isso na tela — em vez de pagar um voto que não contaria.
 */
create or replace function vote_payment_expires_at(p_round_id uuid)
returns timestamptz language sql stable as $$
  select least(
    now() + make_interval(secs => s.payment_ttl_seconds),
    r.settle_by
  )
  from rounds r
  join shows s on s.id = r.show_id
  where r.id = p_round_id;
$$;

/**
 * Cria voto pendente + cobrança. Chamada pela Edge Function ANTES de falar com
 * o provedor: assim nunca existe cobrança no Mercado Pago sem linha no banco.
 */
create or replace function create_vote_intent(
  p_round_id     uuid,
  p_candidate_id uuid,
  p_session_id   uuid,
  p_amount_cents int,
  p_provider     pix_provider default 'mercadopago'
) returns table (vote_id uuid, payment_id uuid, weight int, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_round      rounds;
  v_show       shows;
  v_weight     int;
  v_expires    timestamptz;
  v_payment_id uuid;
  v_vote_id    uuid;
begin
  select * into v_round from rounds where id = p_round_id;
  if not found then
    raise exception 'rodada não encontrada' using errcode = 'no_data_found';
  end if;
  if v_round.status <> 'open' or v_round.closes_at <= now() then
    raise exception 'esta rodada já foi encerrada' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_show from shows where id = v_round.show_id;
  if v_show.status <> 'live' then
    raise exception 'o show não está no ar' using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from round_candidates where id = p_candidate_id and round_id = p_round_id
  ) then
    raise exception 'candidata não pertence a esta rodada' using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from audience_sessions where id = p_session_id and show_id = v_show.id
  ) then
    raise exception 'sessão inválida para este show' using errcode = 'foreign_key_violation';
  end if;

  -- o valor do cliente é só uma sugestão: quem manda é a configuração do show
  if p_amount_cents < v_show.vote_min_cents or p_amount_cents > v_show.vote_max_cents then
    raise exception 'valor fora do permitido para este show (% a % centavos)',
      v_show.vote_min_cents, v_show.vote_max_cents using errcode = 'invalid_parameter_value';
  end if;

  v_weight  := compute_vote_weight(v_show.id, p_amount_cents);
  v_expires := vote_payment_expires_at(p_round_id);

  insert into payments (show_id, session_id, purpose, provider, amount_cents, status, expires_at)
  values (v_show.id, p_session_id, 'vote', p_provider, p_amount_cents, 'created', v_expires)
  returning id into v_payment_id;

  insert into votes (round_id, candidate_id, session_id, payment_id, weight, amount_cents, status)
  values (p_round_id, p_candidate_id, p_session_id, v_payment_id, v_weight, p_amount_cents, 'pending')
  returning id into v_vote_id;

  return query select v_vote_id, v_payment_id, v_weight, v_expires;
end $$;

/**
 * Confirma um pagamento. Idempotente por construção: se já estava pago, não faz nada.
 * Chamada pelo handler de webhook DEPOIS de validar assinatura e registrar o evento.
 */
create or replace function confirm_payment(
  p_payment_id   uuid,
  p_paid_at      timestamptz default now(),
  p_end_to_end   text default null,
  p_payer_name   text default null
) returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_round   rounds;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'pagamento % não encontrado', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_payment.status = 'paid' then
    return v_payment;  -- webhook repetido
  end if;

  update payments
     set status = 'paid', paid_at = p_paid_at,
         end_to_end_id = coalesce(p_end_to_end, end_to_end_id),
         payer_name = coalesce(p_payer_name, payer_name)
   where id = p_payment_id
  returning * into v_payment;

  if v_payment.purpose = 'vote' then
    select r.* into v_round
      from rounds r join votes v on v.round_id = r.id
     where v.payment_id = p_payment_id;

    if v_round.status = 'settled' then
      -- Não deveria acontecer: o QR expira antes da apuração. Defesa em profundidade —
      -- o voto não entra no placar e o pagamento fica marcado para estorno.
      update votes set status = 'voided' where payment_id = p_payment_id;
      insert into show_events (show_id, actor, type, payload)
      values (v_payment.show_id, 'system', 'payment_after_settlement',
              jsonb_build_object('payment_id', p_payment_id, 'round_id', v_round.id));
    else
      update votes
         set status = 'confirmed', confirmed_at = p_paid_at
       where payment_id = p_payment_id and status = 'pending';
    end if;

  elsif v_payment.purpose = 'direct_request' then
    update direct_requests
       set status = 'paid',
           queue_position = (
             select coalesce(max(queue_position), 0) + 1
               from direct_requests
              where show_id = v_payment.show_id and status in ('paid', 'accepted')
           )
     where payment_id = p_payment_id and status = 'pending_payment';
  end if;

  return v_payment;
end $$;

/** Cobranças vencidas viram 'expired' e derrubam o voto pendente junto. */
create or replace function expire_stale_payments() returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with expired as (
    update payments set status = 'expired'
     where status in ('created', 'pending')
       and expires_at is not null
       and expires_at <= now()
    returning id
  )
  update votes set status = 'expired'
   where payment_id in (select id from expired) and status = 'pending';

  get diagnostics v_count = row_count;

  update direct_requests set status = 'refunded'
   where status = 'pending_payment'
     and payment_id in (select id from payments where status = 'expired');

  return v_count;
end $$;
