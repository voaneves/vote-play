-- Vote Play — `free_votes_per_round` para de prometer o que o banco recusa.
--
-- A coluna aceita qualquer inteiro ≥ 0 e a RPC `cast_free_vote` compara o uso
-- contra ela. Só que a trava real é um ÍNDICE:
--
--   create unique index votes_one_free_per_session_round
--     on votes (round_id, session_id) where payment_id is null;
--
-- Um voto grátis por sessão por rodada, ponto. Configurar 2 passava na
-- checagem da função e estourava no índice — e o `exception when
-- unique_violation` traduzia isso para "Você já votou nesta rodada", que é
-- mentira: a pessoa tinha, pela configuração, um voto sobrando.
--
-- Duas saídas possíveis, e a escolha aqui é deliberada:
--
--   (a) Deixar N votos funcionarem de verdade: acrescentar uma coluna de ordem
--       (`free_vote_ordinal`) e trocar o índice para
--       (round_id, session_id, free_vote_ordinal). Preserva a corrida sendo
--       decidida pelo índice, que é o ponto do desenho atual.
--   (b) Assumir que a regra do produto é um voto por rodada e fazer a coluna
--       dizer isso.
--
-- Vai (b), porque a INTERFACE também assume um: `get_show_state` devolve
-- `myVoteCandidateId` no singular, a tela marca "✓ Seu voto" numa candidata só
-- e bloqueia o segundo toque com "Você já votou nesta rodada". Manter um botão
-- de configuração que nenhuma superfície sabe honrar é como a Fase 3 descobriu
-- que `free_votes_per_session` mentia — o mesmo erro, um nível abaixo.
--
-- Se um dia N votos virar requisito de produto, o caminho é (a), e ele começa
-- por remover este check.

-- shows existentes com valor impossível são trazidos para o que o banco de
-- fato aplica hoje — ninguém perde nada, porque o segundo voto nunca entrou
update shows set free_votes_per_round = 1 where free_votes_per_round > 1;

alter table shows add constraint shows_free_votes_per_round_range
  check (free_votes_per_round between 0 and 1);

comment on column shows.free_votes_per_round is
  'Voto sem pagamento por dispositivo em CADA rodada: 1 liga, 0 desliga. '
  'O teto de 1 não é preferência e sim o que o índice único '
  'votes_one_free_per_session_round garante — ver 20260915172000.';
