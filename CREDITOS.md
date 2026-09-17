# Créditos, autoria e licenças

O Vote Play foi idealizado, desenhado e desenvolvido por **Victor Neves**
([voaneves.com](https://voaneves.com)), único autor e titular de toda a propriedade
intelectual do projeto — produto, marca, código e conteúdo. Este arquivo separa o que é
autoral do que é código aberto de terceiros usado sob licença.

## O que é autoral

Tudo o que a plateia e o artista veem como identidade do produto:

| Peça | Onde | Como foi feita |
|---|---|---|
| Símbolo (três barras) e logotipo | `brand/logo/` | Desenho próprio, em SVG escrito à mão |
| Favicon, ícones do app e ícone *maskable* | `public/favicon.*`, `public/icon-*.png` | Gerados por `brand/gerar_icones.py` a partir do símbolo — nenhum gerador online, template ou banco de ícones |
| Imagem de compartilhamento | `public/og.png` | Composição própria com o símbolo e a tipografia do sistema |
| Paleta, contraste e brandkit | `brand/`, `src/index.css` | Tokens próprios, auditados por `brand/colors.py` |
| Interface, textos, arquitetura, schema do banco | `src/`, `supabase/` | Código próprio |
| Gerador de QR Code com o símbolo desenhado pelos dados | `src/lib/qr/qrArt.ts` | Código próprio. A ideia de escolher bits livres por álgebra linear para desenhar com os módulos foi publicada por Russ Cox ([QArt](https://research.swtch.com/qart), 2012) — técnica, não código |

**Tipografia:** o app não embute fonte de terceiros; usa a pilha de fontes do sistema do
aparelho. O brandkit em PDF e a imagem de compartilhamento usam fontes livres —
[Archivo](https://github.com/Omnibus-Type/Archivo) (SIL Open Font License 1.1) e
[DejaVu Sans](https://dejavu-fonts.github.io) (licença livre Bitstream Vera/DejaVu).
**Ilustrações e fotos:** não há.

Licença do conjunto: ver [`LICENSE`](LICENSE) — todos os direitos reservados.

## O que é código aberto de terceiros

Usado conforme a licença de cada projeto. Nenhuma dessas peças carrega marca de terceiros
na interface.

### Componentes vendorizados

| Peça | Licença | Origem |
|---|---|---|
| `src/components/ui/button.tsx`, `drawer.tsx`, `sonner.tsx`, `tooltip.tsx` | MIT | [shadcn/ui](https://ui.shadcn.com) — copiados para o repositório, como o projeto recomenda |
| Ícones de interface (lista, música, telão, copiar…) | ISC | [Lucide](https://lucide.dev) |

### Dependências do app (vão para o navegador)

| Pacote | Licença | Repositório |
|---|---|---|
| `@radix-ui/react-slot` | MIT | https://github.com/radix-ui/primitives |
| `@radix-ui/react-tooltip` | MIT | https://github.com/radix-ui/primitives |
| `@supabase/supabase-js` | MIT | https://github.com/supabase/supabase-js |
| `@tanstack/react-query` | MIT | https://github.com/TanStack/query |
| `class-variance-authority` | Apache-2.0 | https://github.com/joe-bell/cva |
| `clsx` | MIT | https://github.com/lukeed/clsx |
| `lucide-react` | ISC | https://github.com/lucide-icons/lucide |
| `qrcode` (só o QR do Pix) | MIT | https://github.com/soldair/node-qrcode |
| `react`, `react-dom` | MIT | https://github.com/facebook/react |
| `react-router-dom` | MIT | https://github.com/remix-run/react-router |
| `sonner` | MIT | https://github.com/emilkowalski/sonner |
| `tailwind-merge` | MIT | https://github.com/dcastil/tailwind-merge |
| `tw-animate-css` | MIT | https://github.com/Wombosvideo/tw-animate-css |
| `vaul` | MIT | https://github.com/emilkowalski/vaul |

### Ferramentas de desenvolvimento (não vão para o navegador)

Vite, Tailwind CSS, TypeScript (Apache-2.0), ESLint, typescript-eslint,
`@vitejs/plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`globals` e os tipos do DefinitelyTyped — todos MIT, salvo onde indicado.

### Serviços

Supabase (banco, autenticação, tempo real) e GitHub Pages (hospedagem). São serviços
contratados, não código incorporado.

Para manter esta lista honesta ao adicionar uma dependência: `npm ls --depth=0` e a licença
de cada pacote novo entram aqui no mesmo commit.
