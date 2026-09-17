import { useEffect, useState } from 'react';
import type { QrSymbol } from '@/lib/qr/qrArt';

/**
 * QR Code com a marca do Vote Play.
 *
 * As três barras não são coladas por cima do código: são desenhadas PELOS
 * DADOS (ver src/lib/qr/qrArt.ts). Nenhum módulo é apagado nem tampado — o
 * código é 100% válido e a correção de erro fica inteira para a câmera.
 *
 * Por que SVG e não PNG: esta peça vai para o PAPEL e para o projetor. Bitmap
 * escalado imprime com a borda dos módulos serrilhada, e módulo serrilhado é
 * módulo que a câmera de celular ruim lê errado. Em vetor sai nítido em
 * qualquer DPI.
 *
 * Por que o coral das barras é mais escuro que o da marca: leitor de QR separa
 * claro de escuro por limiar de luminância. O coral da marca (#F34835) tem
 * luma ~121 de 255 — em cima do limiar. #D2331E tem luma ~96 e contraste
 * 5:1 com o branco, e continua lendo como o coral do Vote Play.
 */

/** Módulos de margem em volta. A "zona de silêncio" é parte da especificação. */
const QUIET_ZONE = 2;
const INK = '#000000';
const LOGO_INK = '#D2331E';

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
  const { ink, logo } = toPaths(symbol, QUIET_ZONE);

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      className={className}
      shapeRendering="crispEdges"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      <rect width={span} height={span} fill="#FFFFFF" />
      <path d={ink} fill={INK} />
      {logo && <path d={logo} fill={LOGO_INK} />}
    </svg>
  );
}

/**
 * Um `path` por cor, em vez de um `<rect>` por módulo: um QR de versão 5 tem
 * 37×37 = 1369 posições, e 1369 nós no DOM travam a impressão.
 */
function toPaths(symbol: QrSymbol, offset: number): { ink: string; logo: string } {
  const ink: string[] = [];
  const logo: string[] = [];
  const { size, modules, role } = symbol;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = row * size + col;
      if (!modules[i]) continue;
      (role[i] === ROLE_LOGO ? logo : ink).push(`M${col + offset} ${row + offset}h1v1h-1z`);
    }
  }
  return { ink: ink.join(''), logo: logo.join('') };
}

/** Espelho de `ROLE_LOGO` — importar o valor puxaria o gerador para o bundle principal. */
const ROLE_LOGO = 2;

function useQrSymbol(value: string, withLogo: boolean): QrSymbol | null {
  const [state, setState] = useState<{ key: string; symbol: QrSymbol } | null>(null);
  const key = `${value}|${withLogo}`;

  useEffect(() => {
    let cancelled = false;
    // Import dinâmico: o gerador só pesa para quem abre o telão ou a folha de
    // impressão. A tela de votação não carrega nada disso. E, fora do render,
    // os ~150 ms da busca pelo desenho não seguram a primeira pintura.
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
