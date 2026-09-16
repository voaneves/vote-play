# Vote Play

> Por **[Victor Neves](https://voaneves.com)** · [github.com/voaneves](https://github.com/voaneves)

Aplicativo web para **pedidos e votação de música em shows ao vivo**. A plateia entra pelo
QR Code ou por um código curto, vota na próxima música pagando via Pix, ou paga um valor
maior para furar a fila e pedir uma música direto.

> Planejamento completo (arquitetura, modelo de dados, roadmap) em `plan.md` — arquivo local,
> não versionado.

## Stack

React 19 · Vite 8 · TypeScript 5.9 (strict) · Tailwind CSS 4 · shadcn/ui · React Router 7
Backend: Supabase no plano Free (Postgres + RPCs + Realtime só no telão) · Pix via Mercado Pago na Fase 7

O plano Free é requisito de arquitetura, não detalhe: a plateia acompanha o show por polling
com versão, e só o telão usa websocket. Números e motivos em `plan.md`, seção 8.

## Rodando localmente

```bash
npm install
cp .env.example .env
npm run dev
```

A aplicação sobe em `http://localhost:8080/vote-play/`.

Sem backend configurado, tudo roda contra um provider em memória, com três shows de
demonstração — um por modo de votação:

| Código | Modo | O que testar |
|---|---|---|
| `PAGAR1` | `pix` | Seletor de valor, QR Pix e confirmação (simulada após 5 s) |
| `GRAM99` | `instagram` | Portão do perfil: tocar em Seguir, declarar o @, votar |
| `FREE01` | `free` | Voto grátis e direto, um por rodada |

Nos três, a votação simula outras pessoas votando. **`supabase/seed.sql` cria os mesmos
três códigos no banco**, então trocar de provider não muda o que se digita na entrada.

Os códigos usam o alfabeto Crockford, sem `I`, `L`, `O` e `U` — o que parece um "i" é um
"1" e o que parece um "o" é um zero. Tanto o mock quanto o seed recusam um código fora
desse alfabeto em vez de deixá-lo quebrar na mão de quem for digitar.

## Rotas

| Rota | Tela |
|---|---|
| `/` | Entrada por código |
| `/s/:code` | Show: votação e pedido de música |
| `/s/:code/pix/:paymentId` | Cobrança Pix (copia-e-cola + QR) |
| `/telao/:code` | Modo telão: QR grande e ranking ao vivo |
| `/painel` | Painel do artista: shows, rodada ao vivo, repertório, QR, métricas |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve o build local |
| `npm run typecheck` | TypeScript nos dois projetos (a raiz sozinha não checa nada) |
| `npm run lint` | ESLint |
| `bash supabase/tests/run.sh` | Suíte do banco num Postgres descartável |

## Deploy

Push na `main` dispara o workflow do GitHub Pages. O build copia `index.html` para
`404.html` para que links profundos (`/vote-play/s/PAGAR1`) funcionem em hospedagem estática.

## Componentes de UI

O projeto mantém apenas os 4 componentes shadcn/ui realmente usados (`button`, `drawer`,
`sonner`, `tooltip`). Os outros 45 que vinham no scaffold foram removidos junto com suas
dependências. Para adicionar um novo quando o painel do artista precisar:

```bash
npx shadcn@latest add table select dialog
```

## Arquitetura em uma frase

Toda comunicação com o backend passa pela interface `VotePlayApi` (`src/lib/api/types.ts`),
com duas implementações — `mock` (em memória) e `supabase` — que a UI não distingue.

---

## Autoria e licença

Projeto concebido, desenhado e desenvolvido por **Victor Neves**
— [voaneves.com](https://voaneves.com) · [github.com/voaneves](https://github.com/voaneves).
Isso inclui a arquitetura, o schema do banco, a interface, os textos e a
identidade visual (`brand/`).

© 2026 Victor Neves. Todos os direitos reservados. Ver [`LICENSE`](LICENSE) —
o repositório é público para demonstração, não para reúso.
