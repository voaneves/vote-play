# Marca — Vote Play

O guia completo está em **`vote-play-brandkit.pdf`** (10 páginas: essência, arquétipos,
voz, logo, cores, acessibilidade, tipografia, aplicações e tokens).

## Arquivos

| Arquivo | O que é |
|---|---|
| `vote-play-brandkit.pdf` | O guia, para leitura e compartilhamento |
| `brandkit.html` | A fonte do PDF — edite aqui, nunca o PDF |
| `logo/` | Símbolo, assinatura horizontal e monocromáticas, em SVG |
| `colors.py` | Converte os tokens HSL para HEX e mede contraste WCAG |
| `verify.py` | Confere se todos os pares da interface passam no AA |

## Regenerar o PDF

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/brand/brandkit.html', { waitUntil: 'networkidle' });
  await p.pdf({ path: 'brand/vote-play-brandkit.pdf', format: 'A4', printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await b.close();
})();
"
```

## Ao mudar qualquer cor

1. Atualize o token em `src/index.css` — ele é a fonte da verdade, não o PDF.
2. Rode `python3 brand/colors.py` e depois `python3 brand/verify.py`.
3. Se algum par cair abaixo de **4.5:1**, corrija antes de seguir.
4. Atualize `brandkit.html` e regenere o PDF.

O texto sobre cor viva usa **rótulo escuro**, nunca branco — foi assim que o botão
"Pagar com Pix" saiu de 3.31:1 (reprovado) para 5.27:1.
