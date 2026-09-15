-- Vote Play — resumo do show
--
-- Fecha o ciclo: o artista termina a noite e quer saber o que aconteceu.
-- Quais rodadas rolaram, quem venceu cada uma, quanta gente participou.
--
-- Também é o material que ele posta no story no dia seguinte — que é
-- marketing nosso de graça, então vale entregar bonito.

create or replace function show_summary(p_show_id uuid)
returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_show shows;
begin
  perform assert_show_owner(p_show_id);

  select * into v_show from shows where id = p_show_id;
  if not found then
    raise exception 'show % não encontrado', p_show_id using errcode = 'no_data_found';
  end if;

  return json_build_object(
    'show', json_build_object(
      'id',        v_show.id,
      'title',     v_show.title,
      'venue',     v_show.venue,
      'city',      v_show.city,
      'status',    v_show.status,
      'voteMode',  v_show.vote_mode,
      'joinCode',  v_show.join_code,
      'startedAt', v_show.started_at,
      'endedAt',   v_show.ended_at
    ),

    'totals', json_build_object(
      -- só rodada apurada conta como "rodada que rolou": uma aberta ainda
      -- não tem vencedora, e uma cancelada não aconteceu
      'rounds', (
        select count(*) from rounds
         where show_id = p_show_id and status = 'settled'
      ),
      -- toda sessão que entrou, com @ ou sem: é o alcance real do show
      'participants', (
        select count(*) from audience_sessions where show_id = p_show_id
      ),
      -- quantas dessas declararam o @ (0 fora do modo instagram)
      'withInstagram', (
        select count(*) from audience_sessions
         where show_id = p_show_id and instagram_handle is not null
      ),
      'votes', (
        select count(*)
          from votes v join rounds r on r.id = v.round_id
         where r.show_id = p_show_id and v.status = 'confirmed'
      ),
      -- soma dos contadores denormalizados da rodada, não das linhas de voto:
      -- é a mesma fonte que o placar mostrou ao vivo, então não diverge dele
      'amountCents', (
        select coalesce(sum(total_amount_cents), 0)::bigint
          from rounds where show_id = p_show_id and status = 'settled'
      )
    ),

    'rounds', coalesce((
      select json_agg(
               json_build_object(
                 'id',          r.id,
                 'seq',         r.seq,
                 'label',       r.label,
                 'status',      r.status,
                 'settledAt',   r.settled_at,
                 'totalVotes',  r.total_votes,
                 'totalWeight', r.total_weight,
                 'amountCents', r.total_amount_cents,
                 'winner', case when w.id is null then null else json_build_object(
                   'title',      w.title,
                   'artistName', w.artist_name,
                   'weight',     w.weight,
                   'votes',      w.votes_count
                 ) end,
                 -- as demais candidatas, para o artista ver o que quase ganhou
                 'runnersUp', coalesce((
                   select json_agg(
                            json_build_object('title', c.title, 'weight', c.weight)
                            order by c.weight desc, c.first_vote_at nulls last
                          )
                     from round_candidates c
                    where c.round_id = r.id
                      and c.id is distinct from r.winner_candidate_id
                 ), '[]'::json)
               )
               order by r.seq
             )
        from rounds r
        left join round_candidates w on w.id = r.winner_candidate_id
       where r.show_id = p_show_id
         and r.status <> 'cancelled'
    ), '[]'::json)
  );
end $$;

-- Mesma trava das outras funções de painel: no Postgres uma função nasce
-- executável por `public`, então revogar e conceder nominalmente é obrigatório.
revoke all on function show_summary(uuid) from public;
grant execute on function show_summary(uuid) to authenticated, service_role;

comment on function show_summary(uuid) is
  'Resumo do show para o painel do artista: rodadas, vencedoras e totais.';
