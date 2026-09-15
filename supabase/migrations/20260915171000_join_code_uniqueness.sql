-- Vote Play — o código do show deixa de poder colidir entre rascunhos.
--
-- Buraco: `shows_join_code_active` só exigia unicidade entre shows em
-- ('ready','live','paused'), e `generate_join_code()` sondava esse mesmo
-- conjunto. Dois shows em `draft` podiam nascer com o MESMO código.
--
-- Isso não era teórico depois da migration …140000_join_show_status: ela fez
-- `join_show` procurar SEM filtrar status, para poder dizer "ainda não está no
-- ar" em vez de "não encontrado". Com código repetido, o `select ... into`
-- escolhe uma linha arbitrária — e o artista podia ouvir "este show ainda não
-- está no ar" apontando para o rascunho, com o show de verdade no ar ao lado.
-- Pior ainda: os dois rascunhos subiriam para `live` até o índice antigo
-- recusar o segundo, no meio do show.
--
-- Três movimentos, nesta ordem (a ordem importa: o gerador precisa já conhecer
-- a regra nova antes de ser usado para desempatar os códigos existentes).

-- ---------------------------------------------------------------------------
-- 1. O gerador passa a reservar o código desde o rascunho
-- ---------------------------------------------------------------------------

create or replace function generate_join_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes  bytea;
  code     text;
  attempt  int := 0;
begin
  loop
    -- 16 bytes de aleatoriedade forte, sem depender de pgcrypto
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

    code := '';
    for i in 0..5 loop
      -- o alfabeto tem exatamente 32 símbolos, então o módulo não enviesa
      code := code || substr(alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;

    -- 'draft' entrou na lista: o código é reservado no instante em que o show
    -- é criado, não só quando ele sobe para o ar. Shows 'ended'/'cancelled'
    -- continuam liberando o código de volta — são 32^6 ≈ 1,07 bilhão de
    -- combinações, mas reciclar é o que mantém códigos curtos viáveis.
    exit when not exists (
      select 1 from shows
       where join_code = code
         and status in ('draft', 'ready', 'live', 'paused')
    );

    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'não foi possível gerar um código de show livre após % tentativas', attempt;
    end if;
  end loop;
  return code;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Desempate do que já existe, antes de apertar o índice
--
-- Sem isso, um banco que já tenha dois rascunhos com o mesmo código recusaria
-- a migration inteira — e a correção viraria um incidente em vez de resolver
-- um. O show mais antigo fica com o código; os demais ganham um novo.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_novo text;
begin
  for r in
    select id, join_code
      from (
        select id, join_code,
               row_number() over (partition by join_code order by created_at, id) as n
          from shows
         where status in ('draft', 'ready', 'live', 'paused')
      ) t
     where n > 1
  loop
    v_novo := generate_join_code();
    update shows set join_code = v_novo where id = r.id;
    raise notice 'código % estava repetido; show % passou a usar %',
      r.join_code, r.id, v_novo;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. O índice passa a cobrir o rascunho
-- ---------------------------------------------------------------------------

drop index if exists shows_join_code_active;
create unique index shows_join_code_claimed
  on shows (join_code) where status in ('draft', 'ready', 'live', 'paused');

comment on index shows_join_code_claimed is
  'Código único entre shows que ainda podem receber gente — rascunho incluído, '
  'porque o artista imprime o QR antes de colocar o show no ar.';

-- ---------------------------------------------------------------------------
-- 4. join_show escolhe deterministicamente
--
-- Mesmo com o índice acima, um show 'ended' pode dividir o código com um show
-- novo (é assim que a reciclagem funciona). Nesse caso quem responde tem de
-- ser o show que está no ar — nunca o do mês passado.
-- ---------------------------------------------------------------------------

create or replace function join_show(
  p_join_code text, p_device_hash text, p_nickname text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_show    shows;
  v_session audience_sessions;
begin
  if p_device_hash is null or length(btrim(p_device_hash)) < 8 then
    raise exception 'identificador de dispositivo inválido' using errcode = 'invalid_parameter_value';
  end if;

  -- busca SEM filtrar por status, para poder explicar o porquê — mas com
  -- ordem explícita, para que "o show no ar" sempre ganhe do homônimo velho
  select * into v_show
    from shows
   where join_code = upper(btrim(p_join_code))
   order by case status
              when 'live'      then 0
              when 'paused'    then 1
              when 'ready'     then 2
              when 'draft'     then 3
              when 'ended'     then 4
              else                  5
            end,
            created_at desc
   limit 1;

  if not found then
    raise exception 'Código do show não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_show.status in ('draft', 'ready') then
    raise exception 'Este show ainda não está no ar. O artista precisa abri-lo no painel.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_show.status in ('ended', 'cancelled') then
    raise exception 'Este show já terminou.' using errcode = 'invalid_parameter_value';
  end if;

  insert into audience_sessions (show_id, device_hash, nickname)
  values (v_show.id, p_device_hash, nullif(btrim(coalesce(p_nickname, '')), ''))
  on conflict (show_id, device_hash) do update
    set last_seen_at = now(),
        nickname = coalesce(excluded.nickname, audience_sessions.nickname)
  returning * into v_session;

  return json_build_object(
    'show', json_build_object(
      'id', v_show.id, 'joinCode', v_show.join_code, 'title', v_show.title,
      'venue', v_show.venue, 'city', v_show.city, 'coverUrl', v_show.cover_url,
      'status', v_show.status, 'voteMode', v_show.vote_mode,
      'instagramHandle', v_show.instagram_handle,
      'voteMinCents', v_show.vote_min_cents, 'voteMaxCents', v_show.vote_max_cents,
      'voteSuggestedCents', v_show.vote_suggested_cents,
      'centsPerPoint', v_show.cents_per_point,
      'freeVotesPerRound', v_show.free_votes_per_round,
      'roundDurationSeconds', v_show.round_duration_seconds,
      'directRequestEnabled', v_show.direct_request_enabled,
      'directRequestPriceCents', v_show.direct_request_price_cents
    ),
    'session', json_build_object(
      'id', v_session.id, 'showId', v_session.show_id,
      'nickname', v_session.nickname,
      'freeVotesUsed', v_session.free_votes_used,
      'instagramHandle', v_session.instagram_handle,
      'followClickedAt', v_session.instagram_follow_clicked_at
    )
  );
end $$;

revoke all on function join_show(text, text, text) from public;
grant execute on function join_show(text, text, text) to anon, authenticated;
