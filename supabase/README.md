# Base de dados — Vote Play

Schema, funções, RLS e seed do Supabase. Referência completa em `../plan.md`, seção 5.

## Estrutura

```
supabase/
├─ config.toml                 configuração do CLI (supabase start / db diff)
├─ seed.sql                    artista, repertório e TRÊS shows no ar — SÓ desenvolvimento
├─ migrations/                 25 arquivos, aplicados em ordem de nome
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
│  ├─ …0916120000_reaplicar_correcoes      correções de 15/09 no schema, não só no histórico
│  ├─ …0916140000_rate_limit               1ª versão do rate limit (substituída pela seguinte)
│  ├─ …0916170000_rate_limit_pico          teto que não barra a plateia no pico (plan.md, 8.4)
│  ├─ …0916180000_rls_encerramento_snapshot  anon sem `shows`, fim do show, snapshot com versão
│  └─ …0916200000_fila_repertorio          fila do repertório: apoios, ranking, tocada (plan.md, 5.1)
└─ tests/
   ├─ 00_supabase_stub.sql     emula auth.users/auth.uid() fora do Supabase
   ├─ 01…11                    rodada, apuração, RLS, painel, voto grátis, Instagram
   ├─ 12_tick_scope.sql        tick_rounds() na mão do artista não toca em show alheio
   ├─ 13_join_code.sql         código exclusivo desde o rascunho; reciclado não confunde
   ├─ 14_free_vote_limit.sql   a configuração não promete mais que o índice cumpre
   ├─ 15_expire_payments.sql   contagem do vencimento e queda de voto e pedido junto
   ├─ 16_rate_limit.sql        300 aparelhos no mesmo IP entram; recusa não conta
   ├─ 17_revisao_16_09.sql     isolamento no painel, fila sem valor, fim do show, versão
   ├─ 18_fila_repertorio.sql   apoio, orçamento, estado compacto, tocada, recusas, privilégios
   └─ run.sh                   roda tudo num Postgres descartável e imprime o total
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

> **Refazer o `supabase link` NÃO resolve.** O link guarda a senha no Gerenciador de
> Credenciais do Windows e isso funciona — mas a CLI tenta criar o papel temporário
> *antes* de chegar a usá-la, então o erro acontece igual. Verificado em 16/09.

A senha está em *Project Settings → Database → Database password* (se não souber, dá
para gerar outra ali).

### Deixando a senha guardada, só neste projeto

Digitar `$env:SUPABASE_DB_PASSWORD` a cada terminal cansa, e gravá-la no ambiente do
usuário (`SetEnvironmentVariable ... 'User'`) a deixa em texto puro no registro,
herdada por todo processo que você abrir. Como esta senha só serve a este repositório,
ela mora no `.env` daqui:

```ini
# .env  (ignorado pelo git)
SUPABASE_DB_PASSWORD=a-senha-do-banco
```

**Sem o prefixo `VITE_`, ela não chega ao navegador.** O `vite.config.ts` chama
`loadEnv(mode, __dirname, 'VITE_')`, que filtra por prefixo — verificado com canário:
uma senha falsa no `.env`, build completo, busca no `dist/` inteiro, zero ocorrências,
enquanto a chave publishable aparece como esperado.

A CLI lê o `.env` para substituir `env()` no `config.toml`, mas isso **não** garante
que ela exporte a variável para o próprio processo. Então carregue explicitamente.
No seu `$PROFILE` do PowerShell (`notepad $PROFILE`):

```powershell
function Import-DotEnv {
  param([string]$Arquivo = ".\.env")
  if (-not (Test-Path $Arquivo)) { Write-Warning "sem .env aqui"; return }
  Get-Content $Arquivo | ForEach-Object {
    if ($_ -match '^\s*([^#=\s][^=]*?)\s*=\s*(.*)$') {
      Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim().Trim('"').Trim("'")
    }
  }
}

# atalho: vai para o projeto e já carrega o .env
function vp { Set-Location D:\GitHub\vote-play; Import-DotEnv }
```

E o uso passa a ser:

```powershell
vp
supabase db push --include-seed
```

**bash / zsh**, para o mesmo efeito:

```bash
set -a; source .env; set +a
supabase db push --include-seed
```

Alternativa com a string de conexão explícita:

```bash
supabase db reset --db-url "postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
```

Pegue a string em *Connect → Session pooler*. Use **porta 5432** (session pooler ou
conexão direta) — a 6543 é o transaction pooler e não serve para migrations, porque
não mantém sessão nem suporta comandos transacionais de DDL.

## Rodar os testes localmente

```bash
bash supabase/tests/run.sh
```

Sobe um Postgres temporário, aplica tudo do zero e exercita a suíte. Precisa de
`postgresql-16`+ instalado. Nenhum teste toca no projeto remoto.

## Depois de aplicar

1. **Realtime**: em *Database → Replication*, a publicação `supabase_realtime` deve ter
   `rounds` e `direct_requests` — e **não** `round_candidates`, que saiu na `20260916180000`. Só o
   telão assina; a plateia consulta por polling (plano Free, `plan.md` seção 8).
2. **pg_cron**: ative em *Database → Extensions* se ainda não estiver. As migrations
   agendam `tick_rounds()` a cada 10s, `expire_stale_payments()` a cada minuto e
   `purge_rate_limits()` a cada 10 min. Se a extensão foi ativada depois do `db push`,
   rode de novo `20260914120500_realtime_and_cron.sql` e o bloco final de `20260916140000_rate_limit.sql`.
   Sem pg_cron, o painel chama `tick_rounds()` a cada 5s enquanto houver rodada ativa
   (`src/pages/painel/ShowLive.tsx`) — por isso ela também é liberada para
   `authenticated`, escopada aos shows do próprio artista.
   **Atenção:** essa rede de segurança só cobre o show que estiver aberto no painel.
   `expire_stale_payments()` não tem equivalente no front e continua dependendo do
   pg_cron — o que só passa a importar na Fase 7, quando houver dinheiro de verdade.
3. **Auth**: em *Authentication → URL Configuration*, adicione a URL do GitHub
   Pages às redirect URLs.
4. **Chaves**: copie a URL e a chave *publishable* para o `.env`. A secreta
   **nunca** entra no `.env` do front — ela vive só nas Edge Functions.
5. **IP de verdade**: no primeiro teste, entre no mesmo show com um celular no 4G e outro no
   wi-fi e rode `select count(distinct ip_hash) from audience_sessions where show_id = '…'`.
   Tem de dar 2. Se der 1, o teto de entrada por IP está agrupando todo mundo: suba
   `join_rate_limit` para 10000 e veja `plan.md`, 8.4.
6. **Não deixe o projeto pausar**: o Free pausa depois de 7 dias sem uso. Abra o painel na
   semana de cada show e confira na véspera.

## Invariantes que os testes protegem

- Voto pendente não pesa no placar; só o Pix confirmado conta.
- Webhook repetido não dobra voto (`payment_events` tem unique no id do evento).
- Nenhum voto entra em rodada apurada — trava no trigger, não só na aplicação.
- O QR Pix nunca expira depois da apuração da rodada.
- A chave `anon` lê o placar e mais nada; não escreve em lugar nenhum, não lista shows e
  não vê valor nem sessão de pedido.
- Um artista não enxerga shows nem pedidos de outro artista, nem pela tabela.
- Um artista não enxerga nem mexe no show de outro, nem via função do painel.
- `tick_rounds()` na mão de um artista move a rodada **dele** e não aborta ao encontrar a
  de outro — sem isso, a rede de segurança do cronômetro deixaria de existir para todos a
  partir do segundo artista cadastrado.
- O código de entrada é exclusivo desde o rascunho, e um código reciclado de show
  encerrado devolve o show que está no ar.
- `free_votes_per_round` não aceita um valor que o índice único não consiga cumprir.
- `expire_stale_payments()` devolve quantos pagamentos expiraram — e derruba o voto
  pendente e o pedido não pago na mesma passada.
- 300 aparelhos atrás do mesmo IP entram no primeiro minuto; tentativa recusada não conta.
- Encerrar o show apura a rodada aberta, cancelar cancela; encerrado não volta ao ar.
- `get_show_state` com a versão atual responde só `unchanged`, e qualquer mudança visível —
  inclusive o próprio voto — troca a versão.
- Fila: um apoio por pessoa por música, orçamento por pessoa que volta quando a música toca,
  música em rodada aberta não recebe apoio, só o dono marca tocada, e o artista não reescreve
  peso nem status pela tabela.
