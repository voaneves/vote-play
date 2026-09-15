import { useEffect, useState } from 'react';

/**
 * QR Code com a marca do Vote Play.
 *
 * Por que SVG e não a imagem PNG que o resto do app usa: esta peça vai para o
 * PAPEL e para o projetor. Bitmap escalado imprime com a borda dos módulos
 * serrilhada, e módulo serrilhado é módulo que a câmera de celular ruim lê
 * errado. Em vetor o código sai nítido em qualquer DPI.
 *
 * Por que os módulos continuam pretos sobre branco: leitor de QR separa claro
 * de escuro por limiar de luminância. Coral (#F34835) sobre vinho tem contraste
 * bonito para o olho e péssimo para o algoritmo — ainda mais com câmera barata,
 * em bar escuro, de dois metros. A marca entra na moldura, no símbolo do centro
 * e na tipografia; nunca nos módulos.
 */

/** Lado da plaqueta do logo, como fração da largura do QR. */
const LOGO_PLATE_RATIO = 0.24;
/** Quanto do lado da plaqueta o símbolo ocupa (o resto é respiro). */
const LOGO_INSET = 0.62;
/** Módulos de margem em volta. A "zona de silêncio" é parte da especificação. */
const QUIET_ZONE = 2;

interface Matrix {
  size: number;
  data: Uint8Array;
}

export function VotePlayQr({
  value,
  withLogo = true,
  className,
  title,
}: {
  value: string;
  /**
   * O logo cobre módulos no centro. Só é seguro porque subimos a correção de
   * erro para o nível H, que recupera ~30% do código — e mesmo assim a
   * plaqueta fica em ~6% da área, não nos 25% que seriam o teto teórico:
   * dano concentrado num bloco custa mais ao decodificador que dano espalhado.
   */
  withLogo?: boolean;
  className?: string;
  title?: string;
}) {
  const matrix = useQrMatrix(value, withLogo);
  if (!matrix) return null;

  const span = matrix.size + QUIET_ZONE * 2;
  const center = span / 2;
  const plate = matrix.size * LOGO_PLATE_RATIO;
  const logo = plate * LOGO_INSET;

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      className={className}
      shapeRendering="crispEdges"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      <rect width={span} height={span} fill="#FFFFFF" />
      <path d={toPath(matrix, QUIET_ZONE)} fill="#000000" />

      {withLogo && (
        <g>
          {/*
            A plaqueta branca não é enfeite: o símbolo é coral, e coral direto
            sobre módulo preto some. Branco embaixo devolve o contraste e ainda
            avisa o decodificador de que ali é região clara, sem meio-termo.
          */}
          <rect
            x={center - plate / 2}
            y={center - plate / 2}
            width={plate}
            height={plate}
            rx={plate * 0.16}
            fill="#FFFFFF"
          />
          <g
            transform={`translate(${center - logo / 2} ${center - logo / 2}) scale(${logo / 40})`}
            fill="#F34835"
          >
            {/* três barras ascendentes — o placar do show em miniatura */}
            <rect x="0" y="24" width="9" height="16" rx="4.5" />
            <rect x="15.5" y="12" width="9" height="28" rx="4.5" />
            <rect x="31" y="0" width="9" height="40" rx="4.5" />
          </g>
        </g>
      )}
    </svg>
  );
}

/**
 * Um `path` só para o código inteiro, em vez de um `<rect>` por módulo.
 * Um QR de versão 5 tem 37×37 = 1369 posições; virar 1369 nós no DOM trava a
 * impressão e infla o SVG à toa.
 */
function toPath(matrix: Matrix, offset: number): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.data[row * matrix.size + col]) {
        parts.push(`M${col + offset} ${row + offset}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

function useQrMatrix(value: string, withLogo: boolean): Matrix | null {
  const [state, setState] = useState<{ key: string; matrix: Matrix } | null>(null);
  const key = `${value}|${withLogo}`;

  useEffect(() => {
    let cancelled = false;
    // Import dinâmico: a biblioteca de QR só pesa para quem abre o telão ou a
    // folha de impressão. A tela de votação não carrega nada disso.
    void import('qrcode')
      .then(({ default: QRCode }) => {
        // Nível H sempre que houver logo. Sem logo, M basta e gera um código
        // com menos módulos — que lê de mais longe.
        const qr = QRCode.create(value, { errorCorrectionLevel: withLogo ? 'H' : 'M' });
        if (!cancelled) {
          setState({ key, matrix: { size: qr.modules.size, data: qr.modules.data } });
        }
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
  return state && state.key === key ? state.matrix : null;
}
