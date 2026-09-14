# Vote Play

Aplicativo web para **pedidos e votação de música em shows ao vivo**. A plateia entra pelo
QR Code ou por um código curto, vota na próxima música pagando via Pix, ou paga um valor
maior para furar a fila e pedir uma música direto.

> Planejamento completo (arquitetura, modelo de dados, roadmap) em `plan.md` — arquivo local,
> não versionado.

## Stack

React 19 · Vite 8 · TypeScript 5.9 (strict) · Tailwind CSS 4 · shadcn/ui · React Router 7
Backend previsto: Supabase (Postgres + Realtime + Edge Functions) · Pix via Mercado Pago

## Rodando localmente

```bash
npm install
cp .env.example .env
npm run dev
```

A aplicação sobe em `http://localhost:8080/vote-play/`.

Sem backend configurado (`VITE_API_PROVIDER=mock`), tudo roda contra um provider em memória.
Use o código **`TESTE1`** para entrar no show de demonstração — a votação simula outras
pessoas votando e confirma o "Pix" automaticamente após 5 segundos.

## Rotas

| Rota | Tela |
|---|---|
| `/` | Entrada por código |
| `/s/:code` | Show: votação e pedido de música |
| `/s/:code/pix/:paymentId` | Cobrança Pix (copia-e-cola + QR) |
| `/telao/:code` | Modo telão: QR grande e ranking ao vivo |
| `/painel` | Painel do artista (Fase 1) |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve o build local |
| `npm run lint` | ESLint |

## Deploy

Push na `main` dispara o workflow do GitHub Pages. O build copia `index.html` para
`404.html` para que links profundos (`/vote-play/s/TESTE1`) funcionem em hospedagem estática.

## Componentes de UI

O projeto mantém apenas os 4 componentes shadcn/ui realmente usados (`button`, `drawer`,
`sonner`, `tooltip`). Os outros 45 que vinham no scaffold foram removidos junto com suas
dependências. Para adicionar um novo quando o painel do artista precisar:

```bash
npx shadcn@latest add table select dialog
```

## Arquitetura em uma frase

Toda comunicação com o backend passa pela interface `VotePlayApi` (`src/lib/api/types.ts`).
Hoje existe a implementação `mock`; a implementação `supabase` entra sem que nenhum
componente de UI precise mudar.
