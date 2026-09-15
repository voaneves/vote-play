# Base de dados — Vote Play (Fase 1)

Schema, funções, RLS e seed do Supabase. Referência completa em `../plan.md`, seção 5.

## Estrutura

```
supabase/
├─ config.toml                 configuração do CLI (supabase start / db diff)
├─ seed.sql                    artista, repertório e TRÊS shows no ar — SÓ desenvolvimento
├─ migrations/                 19 arquivos, aplicados em ordem de nome
│  ├─ …120000_enums.sql        tipos do domínio
│  ├─ …120100_tables.sql       13 tabelas
│  ├─ …120200_functions.sql    regras de rodada, voto e pagamento
│  ├─ …120300_triggers.sql     apuração do placar e travas de integridade
│  ├─ …120400_rls.sql          Row Level Security
│  ├─ …120450_grants.sql       privilégios de tabela e de função
│  ├─ …120500_realtime_and_cron.sql   publicação de Realtime + pg_cron
│  ├─ …120600_public_api.sql   join_show e get_show_state (a plateia não toca em tabela)
│  ├─ …120900_free_vote.sql    cast_free_vote e o índice de um voto por rodada
│  ├─ …121000_instagram_gate.sql      modos pix/instagram/free e o portão do @
│  ├─ …1517*                   lote de correções de auditoria (ver plan.md, 12.1)
│  └─ …                        as demais, em ordem cronológica
└─ tests/
   ├─ 00_supabase_stub.sql     emula auth.users/auth.uid() fora do Supabase
   ├─ 01…11                    rodada, apuração, RLS, painel, voto grátis, Instagram
   ├─ 12_tick_scope.sql        tick_rounds() na mão do artista não toca em show alheio
   ├─ 13_join_code.sql         código exclusivo desde o rascunho; reciclado não confunde
   ├─ 14_free_vote_limit.sql   a configuração não promete mais que o índice cumpre
   ├─ 15_expire_payments.sql   contagem do vencimento e queda de voto e pedido junto
   └─ run.sh                   roda tudo num Postgres descartável
```

Os três shows do seed são `PAGAR1` (modo `pix`), `GRAM99` (modo `instagram`) e `FREE01`
(modo `free`) — os mesmos códigos do provider em memória, de propósito.

## Aplicar no projeto do Supabase

```bash
npm install -g supabase          # ou: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ref-do-projeto>
supabase db push                 # aplica as migrations
```

O `<ref-do-projeto>` está na URL do painel: `https://supabase.com/dashboard/project/<ref>`.
O `db push` pede a senha do banco — **a senha é sua, nunca compartilhe**.

Seed (apenas em desenvolvimento):

```bash
supabase db push --include-seed
# ou cole o conteúdo de seed.sql no SQL Editor
```

Alternativa sem CLI: abra o SQL Editor do painel e cole cada arquivo de
`migrations/` na ordem dos nomes, um por vez.

## Quando o `db push` falhar com "relation ... already exists"

Significa que o histórico de migrations e o schema real discordaram — push
interrompido no meio, ou SQL aplicado à mão. Recomece do zero pelo terminal:

```bash
supabase db reset --linked
```

Um comando só: apaga o schema do projeto remoto, reaplica as migrations na ordem
e roda o `seed.sql` no fim. **É destrutivo** — a CLI pede confirmação, e o padrão
do prompt é "sim", então leia antes de apertar Enter.

Se preferir inspecionar antes de apagar, `diagnose.sql` mostra o que existe de
verdade ao lado do que o histórico diz (somente leitura). E `reset_public_schema.sql`
faz a mesma limpeza em SQL puro, para quando você quiser rodar por outro caminho —
os dois funcionam no SQL Editor do painel web (`supabase.com/dashboard/project/<ref>/sql/new`)
ou via `psql`.

## Quando a CLI falhar em "Initialising login role"

```
Failed to create login role: ERROR: 42501: permission denied to alter role
... Only roles with the CREATEROLE attribute and the ADMIN option on role
"cli_login_postgres" may alter this role.
```

Problema do lado do Supabase, não do projeto: em contas provisionadas antes de uma
correção deles, o papel `cli_login_postgres` ficou sem `ADMIN OPTION`, e o Postgres 16+
passou a exigir isso. Não há correção na CLI. O contorno é dar a senha do banco para a
CLI, o que faz ela conectar direto e pular a criação do papel temporário.

**PowerShell:**

```powershell
$env:SUPABASE_DB_PASSWORD = "sua-senha-do-banco"
supabase db reset --linked
```

**bash / zsh:**

```bash
export SUPABASE_DB_PASSWORD='sua-senha-do-banco'
supabase db reset --linked
```

A variável vive só naquele terminal. A senha está em *Project Settings → Database →
Database password* (se não souber, dá para gerar outra ali).

Alternativa com a string de conexão explícita:

```bash
supabase db reset --db-url "postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
```

Pegue a string em *Connect → Session pooler*. Use **porta 5432** (session pooler ou
conexão direta) — a 6543 é o transaction pooler e não serve para migrations, porque
não mantém sessão nem suporta comandos transacionais de DDL.

## Rodar os testes localmente

```bash
./supabase/tests/run.sh
```

Sobe um Postgres temporário, aplica tudo do zero e exercita a suíte. Precisa de
`postgresql-16`+ instalado. Nenhum teste toca no projeto remoto.

## Depois de aplicar

1. **Realtime**: confirme em *Database → Replication* que `round_candidates`,
   `rounds` e `direct_requests` estão na publicação `supabase_realtime`.
2. **pg_cron**: ative em *Database → Extensions* se ainda não estiver. A migration
   agenda `tick_rounds()` a cada 10s e `expire_stale_payments()` a cada minuto.
   Sem pg_cron, o painel chama `tick_rounds()` a cada 5s enquanto houver rodada ativa
   (`src/pages/painel/ShowLive.tsx`) — por isso ela também é liberada para
   `authenticated`, escopada aos shows do próprio artista.
   **Atenção:** essa rede de segurança só cobre o show que estiver aberto no painel.
   `expire_stale_payments()` não tem equivalente no front e continua dependendo do
   pg_cron — o que só passa a importar na Fase 7, quando houver dinheiro de verdade.
3. **Auth**: em *Authentication → URL Configuration*, adicione a URL do GitHub
   Pages às redirect URLs.
4. **Chaves**: copie a URL e a `anon` para o `.env`. A `service_role`
   **nunca** entra no `.env` do front — ela vive só nas Edge Functions.

## Invariantes que os testes protegem

- Voto pendente não pesa no placar; só o Pix confirmado conta.
- Webhook repetido não dobra voto (`payment_events` tem unique no id do evento).
- Nenhum voto entra em rodada apurada — trava no trigger, não só na aplicação.
- O QR Pix nunca expira depois da apuração da rodada.
- A chave `anon` lê o placar e mais nada; não escreve em lugar nenhum.
- Um artista não enxerga nem mexe no show de outro, nem via função do painel.
- `tick_rounds()` na mão de um artista move a rodada **dele** e não aborta ao encontrar a
  de outro — sem isso, a rede de segurança do cronômetro deixaria de existir para todos a
  partir do segundo artista cadastrado.
- O código de entrada é exclusivo desde o rascunho, e um código reciclado de show
  encerrado devolve o show que está no ar.
- `free_votes_per_round` não aceita um valor que o índice único não consiga cumprir.
- `expire_stale_payments()` devolve quantos pagamentos expiraram — e derruba o voto
  pendente e o pedido não pago na mesma passada.
