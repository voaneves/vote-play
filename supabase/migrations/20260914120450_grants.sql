-- Vote Play — privilégios de tabela e de função.
--
-- Defesa em profundidade: a RLS decide QUAIS linhas, o GRANT decide SE a role
-- pode sequer tocar na tabela. Um erro de policy sozinho não vira incidente.
--
-- Cuidado central deste arquivo: no Postgres, toda função nasce executável por
-- PUBLIC. Como várias das nossas são SECURITY DEFINER (ignoram RLS), deixá-las
-- assim significaria que a chave anon — que vai pública no bundle — poderia
-- chamar confirm_payment e confirmar um pagamento que ninguém pagou.

revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- ------------------------------------------------------------------ plateia
-- Só leitura, e a RLS acima ainda filtra para shows no ar.
grant select on shows, rounds, round_candidates, direct_requests, public_queue
  to anon, authenticated;

-- ------------------------------------------------------------------ artista
grant select, insert, update, delete on
  profiles, payment_accounts, songs, shows, show_songs, rounds,
  round_candidates, direct_requests
  to authenticated;
grant select on payments, votes, show_events to authenticated;

-- -------------------------------------------------------------- Edge Functions
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- --------------------------------------------------------------- funções
-- Painel do artista: a própria função checa a posse do show (assert_show_owner).
grant execute on function open_round(uuid, uuid[], int, text) to authenticated, service_role;
grant execute on function close_round_voting(uuid)            to authenticated, service_role;
grant execute on function settle_round(uuid, boolean)         to authenticated, service_role;
grant execute on function tick_rounds()                       to authenticated, service_role;

-- Dinheiro: EXCLUSIVAMENTE service_role, ou seja, só as Edge Functions.
grant execute on function create_vote_intent(uuid, uuid, uuid, int, pix_provider) to service_role;
grant execute on function confirm_payment(uuid, timestamptz, text, text)          to service_role;
grant execute on function expire_stale_payments()                                 to service_role;
grant execute on function generate_join_code()                                    to service_role;

-- Leitura de regra, inofensiva e útil para a UI conferir o peso.
grant execute on function compute_vote_weight(uuid, int)   to authenticated, service_role;
grant execute on function vote_payment_expires_at(uuid)    to authenticated, service_role;
