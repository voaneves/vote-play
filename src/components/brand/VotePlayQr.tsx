import { useEffect, useState } from 'react';
import type { QrSymbol } from '@/lib/qr/qrArt';

/**
 * QR Code com a marca do Vote Play.
 *
 * As três barras são desenhadas pelos dados e em meio-tom (ver
 * src/lib/qr/qrArt.ts): na zona do logo, as pílulas coral em vetor; em cada
 * módulo que ainda discorda da arte, um ponto no centro — que é onde o leitor
 * amostra. Nenhum módulo é apagado ou tampado.
 *
 * Por que SVG e não PNG: esta peça vai para o PAPEL e para o projetor. Em
 * vetor sai nítido em qualquer DPI; bitmap escalado serrilha a borda dos
 * módulos, e módulo serrilhado é módulo que câmera ruim lê errado.
 *
 * Cores: módulos em "noite" (#180C0F) — quase preto, com a marca. Barras e
 * miolo dos localizadores num coral de impressão (#D2331E, luma ~96 e 5:1 com
 * o branco): o coral da marca (#F34835, luma ~121) fica em cima do limiar de
 * claro/escuro do leitor.
 */

/** Módulos de margem em volta. A "zona de silêncio" é parte da especificação. */
const QUIET_ZONE = 4;
const INK = '#180C0F';
const LOGO_INK = '#D2331E';
const PAPER = '#FFFFFF';
/** Diâmetro do ponto de meio-tom, em módulos. */
const DOT = 0.45;

// espelhos das constantes do gerador — importar valores puxaria o gerador
// para o bundle principal
const ROLE_LOGO = 2;
const ROLE_HALO = 3;

export function VotePlayQr({
  value,
  withLogo = true,
  className,
  title,
}: {
  value: string;
  withLogo?: boolean;
  className?: string;
  title?: string;
}) {
  const symbol = useQrSymbol(value, withLogo);
  if (!symbol) return null;

  const span = symbol.size + QUIET_ZONE * 2;
  const { squares, darkDots, lightDots } = toPaths(symbol, QUIET_ZONE);
  const finders = [
    [0, 0],
    [symbol.size - 7, 0],
    [0, symbol.size - 7],
  ];

  return (
    <svg viewBox={`0 0 ${span} ${span}`} className={className} role={title ? 'img' : 'presentation'} aria-label={title}>
      <rect width={span} height={span} fill={PAPER} />
      <path d={squares} fill={INK} shapeRendering="crispEdges" />

      {/*
        Localizadores com a marca pela COR (miolo coral), não pela forma. Cantos
        arredondados pareciam inofensivos — o centro de cada módulo continuava
        do lado certo da curva — mas o detector do OpenCV (clássico e ArUco)
        usa os CANTOS do localizador para calcular a perspectiva, e com raio
        ≥ 1 módulo deixou de ler 30 de 30 códigos. Quadrado lê em todos.
      */}
      {finders.map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x + QUIET_ZONE} ${y + QUIET_ZONE})`} shapeRendering="crispEdges">
          <rect width={7} height={7} fill={INK} />
          <rect x={1} y={1} width={5} height={5} fill={PAPER} />
          <rect x={2} y={2} width={3} height={3} fill={LOGO_INK} />
        </g>
      ))}

      {symbol.logoBars?.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x + QUIET_ZONE}
          y={bar.y + QUIET_ZONE}
          width={bar.w}
          height={bar.h}
          rx={bar.w / 2}
          fill={LOGO_INK}
        />
      ))}
      {darkDots && <path d={darkDots} fill={INK} />}
      {lightDots && <path d={lightDots} fill={PAPER} />}
    </svg>
  );
}

const isFinder = (x: number, y: number, size: number) =>
  (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

/**
 * Um `path` por camada, em vez de um nó por módulo: um QR de versão 5 tem
 * 37×37 = 1369 posições, e 1369 nós no DOM travam a impressão.
 */
function toPaths(symbol: QrSymbol, offset: number) {
  const squares: string[] = [];
  const darkDots: string[] = [];
  const lightDots: string[] = [];
  const { size, modules, role } = symbol;
  const r = DOT / 2;
  const hasArt = Boolean(symbol.logoBars);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFinder(x, y, size)) continue;
      const i = y * size + x;
      const inArt = hasArt && (role[i] === ROLE_LOGO || role[i] === ROLE_HALO);
      if (!inArt) {
        if (modules[i]) squares.push(`M${x + offset} ${y + offset}h1v1h-1z`);
        continue;
      }
      const art = role[i] === ROLE_LOGO ? 1 : 0;
      if (modules[i] === art) continue; // a arte já diz o que o dado diz
      const cx = x + offset + 0.5;
      const cy = y + offset + 0.5;
      (modules[i] ? darkDots : lightDots).push(
        `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${DOT} 0a${r} ${r} 0 1 0 ${-DOT} 0`,
      );
    }
  }
  return { squares: squares.join(''), darkDots: darkDots.join(''), lightDots: lightDots.join('') };
}

function useQrSymbol(value: string, withLogo: boolean): QrSymbol | null {
  const [state, setState] = useState<{ key: string; symbol: QrSymbol } | null>(null);
  const key = `${value}|${withLogo}`;

  useEffect(() => {
    let cancelled = false;
    // Import dinâmico: o gerador só pesa para quem abre o telão ou a folha de
    // impressão. A tela de votação não carrega nada disso. E, fora do render,
    // os ~70 ms da busca pela composição não seguram a primeira pintura.
    void import('@/lib/qr/qrArt')
      .then(({ encodeWithLogo, encodeText }) => {
        const symbol = withLogo ? encodeWithLogo(value) : encodeText(value, 'M');
        if (!cancelled) setState({ key, symbol });
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, withLogo, key]);

  // Enquanto o código do valor atual não ficou pronto, nada na tela — melhor
  // que exibir o QR anterior, que levaria a pessoa para o show errado.
  return state && state.key === key ? state.symbol : null;
}
