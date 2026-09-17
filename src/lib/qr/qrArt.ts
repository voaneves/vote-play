/**
 * Gerador de QR Code do Vote Play, com o logo desenhado PELOS DADOS.
 *
 * A técnica é a do QArt, de Russ Cox (research.swtch.com/qart): em vez de
 * apagar módulos no centro e colar o logo por cima — gastando a correção de
 * erro —, o gerador escolhe bits livres da mensagem de modo que os próprios
 * módulos formem o desenho. O código sai 100% válido: a correção de erro fica
 * inteira para câmera ruim, luz de bar e cartão amassado.
 *
 * De onde vêm os bits livres — dois modos (`FreeBits`):
 *
 * - `padding` (padrão): depois da URL vem o terminador (0000) e, até encher a
 *   capacidade, bytes de enchimento. A especificação manda que esses bytes
 *   sejam 0xEC/0x11 alternados, mas o leitor para de ler no terminador e nunca
 *   olha para eles — então eles viram os bits livres, 8 por byte, sem
 *   restrição. O QR carrega SÓ a URL: a câmera mostra `…/s/ABC234`, limpo.
 *   É fora da letra da norma, por isso o teste físico (plan.md, 5.3.1) exige
 *   iPhone e Android.
 * - `fragment` (plano B, 100% dentro da norma): a URL é seguida de "#" e de
 *   dígitos. O defeito é visível — a câmera mostra o número enorme antes de
 *   abrir, com cara de link suspeito. O app apaga o fragmento ao abrir
 *   (main.tsx), mas a prévia já foi vista. Cada grupo de 3 dígitos ocupa 10
 *   bits livres, com a condição de não passar de 999: se algum grupo passa,
 *   só o bit alto DAQUELE grupo é fixado e o sistema é resolvido de novo.
 *
 * Por que dá para resolver: Reed-Solomon é linear. Todo bit do código final —
 * dado ou correção — é um XOR de bits da mensagem. Então "este módulo tem de
 * ser escuro" vira uma equação linear sobre GF(2), e o conjunto de módulos do
 * desenho vira um sistema resolvido por eliminação de Gauss. Quando uma
 * equação contradiz as anteriores, aquele módulo fica como os dados mandarem —
 * por isso os módulos mais importantes do desenho entram primeiro.
 *
 * O resto do arquivo é um codificador de QR comum (modos alfanumérico, byte e numérico,
 * versões 1 a 20), escrito aqui para expor o que as bibliotecas escondem: a
 * posição de cada bit na matriz. A matriz foi conferida bit a bit contra a
 * biblioteca `qrcode`, com a mesma máscara (plan.md, 5.3.1).
 */

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** Papel de cada módulo na peça final — decide a cor ao desenhar. */
export const ROLE_DATA = 0;
export const ROLE_FUNCTION = 1;
/** Módulo da zona do logo cujo centro cai DENTRO de uma barra (a arte é escura ali). */
export const ROLE_LOGO = 2;
/** Módulo da zona do logo fora das barras — o contorno (a arte é clara ali). */
export const ROLE_HALO = 3;

export interface QrSymbol {
  version: number;
  ecc: EccLevel;
  mask: number;
  size: number;
  /** 1 = escuro, linha a linha (`row * size + col`). */
  modules: Uint8Array;
  role: Uint8Array;
  /** O texto que o código carrega de fato (URL + fragmento, quando há logo). */
  text: string;
  /** Módulos do desenho que saíram como pedidos / total pedido. */
  logoHit: number;
  logoTotal: number;
  /**
   * Geometria das barras, só quando TODOS os módulos do desenho saíram certos.
   * Aí dá para desenhá-las como pílulas em vetor: com raio = meia largura, o
   * centro de cada módulo cai do lado certo da curva — e o centro é onde o
   * leitor amostra. Com algum módulo errado, `null`, e o desenho é em módulos.
   */
  logoBars: LogoBar[] | null;
  /**
   * Pior caso de dano, por bloco: códigos tocados pelos módulos do logo que
   * DISCORDAM da arte, dividido pelo que a correção de erro do bloco conserta.
   * ≤ 1 quer dizer que, mesmo que o leitor erre TODOS esses pontos, o código
   * ainda decodifica. 0 = desenho perfeito.
   */
  damage: number;
}

const MAX_VERSION = 20;
const ECC_INDEX: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** [blocos, codewords de correção por bloco] para L, M, Q, H — versões 1 a 20. */
const EC_TABLE: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 7], [1, 10], [1, 13], [1, 17]],
  [[1, 10], [1, 16], [1, 22], [1, 28]],
  [[1, 15], [1, 26], [2, 18], [2, 22]],
  [[1, 20], [2, 18], [2, 26], [4, 16]],
  [[1, 26], [2, 24], [4, 18], [4, 22]],
  [[2, 18], [4, 16], [4, 24], [4, 28]],
  [[2, 20], [4, 18], [6, 18], [5, 26]],
  [[2, 24], [4, 22], [6, 22], [6, 26]],
  [[2, 30], [5, 22], [8, 20], [8, 24]],
  [[4, 18], [5, 26], [8, 24], [8, 28]],
  [[4, 20], [5, 30], [8, 28], [11, 24]],
  [[4, 24], [8, 22], [10, 26], [11, 28]],
  [[4, 26], [9, 22], [12, 24], [16, 22]],
  [[4, 30], [9, 24], [16, 20], [16, 24]],
  [[6, 22], [10, 24], [12, 30], [18, 24]],
  [[6, 24], [10, 28], [17, 24], [16, 30]],
  [[6, 28], [11, 28], [16, 28], [19, 28]],
  [[6, 30], [13, 26], [18, 28], [21, 28]],
  [[7, 28], [14, 26], [21, 26], [25, 26]],
  [[8, 28], [16, 26], [20, 30], [25, 28]],
];

// ---------------------------------------------------------------------------
// Aritmética e tamanhos
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = v;
    GF_LOG[v] = i;
    v = (v << 1) ^ (v & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(x: number, y: number): number {
  return x === 0 || y === 0 ? 0 : GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

const divisorCache = new Map<number, number[]>();
function rsDivisor(degree: number): number[] {
  const hit = divisorCache.get(degree);
  if (hit) return hit;
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  divisorCache.set(degree, result);
  return result;
}

function rsRemainder(data: ArrayLike<number>, divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ (result.shift() as number);
    result.push(0);
    for (let j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
  }
  return result;
}

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number, ecc: EccLevel): number {
  const [blocks, perBlock] = EC_TABLE[ver - 1][ECC_INDEX[ecc]];
  return Math.floor(rawDataModules(ver) / 8) - blocks * perBlock;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

// ---------------------------------------------------------------------------
// Matriz: padrões de função e ordem de colocação dos bits
// ---------------------------------------------------------------------------

interface Grid {
  size: number;
  dark: Uint8Array;
  isFunction: Uint8Array;
}

function setFn(g: Grid, x: number, y: number, dark: boolean) {
  g.dark[y * g.size + x] = dark ? 1 : 0;
  g.isFunction[y * g.size + x] = 1;
}

function drawFormatBits(g: Grid, ecc: EccLevel, mask: number) {
  const data = (ECC_FORMAT[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const s = g.size;
  for (let i = 0; i <= 5; i++) setFn(g, 8, i, bit(i));
  setFn(g, 8, 7, bit(6));
  setFn(g, 8, 8, bit(7));
  setFn(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(g, s - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(g, 8, s - 15 + i, bit(i));
  setFn(g, 8, s - 8, true);
}

function functionGrid(ver: number, ecc: EccLevel, mask: number): Grid {
  const size = ver * 4 + 17;
  const g: Grid = { size, dark: new Uint8Array(size * size), isFunction: new Uint8Array(size * size) };

  for (let i = 0; i < size; i++) {
    setFn(g, 6, i, i % 2 === 0);
    setFn(g, i, 6, i % 2 === 0);
  }

  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(g, x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const align = alignmentPositions(ver);
  const last = align.length - 1;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(g, align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  drawFormatBits(g, ecc, mask);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setFn(g, a, c, b);
      setFn(g, c, a, b);
    }
  }
  return g;
}

/** Índice da célula (`y * size + x`) de cada bit do fluxo final, na ordem de colocação. */
function placementOrder(g: Grid): number[] {
  const order: number[] = [];
  const s = g.size;
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? s - 1 - vert : vert;
        if (!g.isFunction[y * s + x]) order.push(y * s + x);
      }
    }
  }
  return order;
}

interface BlockLayout {
  /** Para cada codeword do fluxo final: [bloco, posição no bloco]. */
  stream: Array<readonly [number, number]>;
  dataLen: number[];
  dataOffset: number[];
  eccLen: number;
}

function blockLayout(ver: number, ecc: EccLevel): BlockLayout {
  const [numBlocks, eccLen] = EC_TABLE[ver - 1][ECC_INDEX[ecc]];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const dataLen: number[] = [];
  const dataOffset: number[] = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    dataLen.push(shortLen - eccLen + (i < numShort ? 0 : 1));
    dataOffset.push(k);
    k += dataLen[i];
  }
  const stream: Array<readonly [number, number]> = [];
  const longest = shortLen + (numShort < numBlocks ? 1 : 0);
  // dados intercalados, depois correção intercalada
  for (let i = 0; i < longest - eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) if (i < dataLen[b]) stream.push([b, i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) stream.push([b, dataLen[b] + i]);
  }
  return { stream, dataLen, dataOffset, eccLen };
}

// ---------------------------------------------------------------------------
// Mensagem: modo byte + (opcional) modo numérico com bits livres
// ---------------------------------------------------------------------------

/** Bit da mensagem: -1 = 0 fixo, -2 = 1 fixo, k ≥ 0 = variável livre k. */
const ZERO = -1;
const ONE = -2;

interface Message {
  bits: Int32Array;
  freeCount: number;
  digitGroups: number;
  /** Posição, no fluxo de bits da mensagem, do primeiro bit do 1º grupo numérico. */
  digitStart: number;
}

/** Onde ficam os bits que desenham o logo. Ver o comentário do topo. */
export type FreeBits = 'padding' | 'fragment';

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Trecho da mensagem: alfanumérico (5,5 bits/caractere) ou byte (8). */
export interface Segment {
  mode: 'alnum' | 'byte';
  data: string;
}

/**
 * Divide a URL em [esquema + domínio em MAIÚSCULAS, alfanumérico] + [resto,
 * byte]. Esquema e domínio não diferenciam maiúsculas — o navegador os
 * normaliza antes de pedir a página (conferido em voaneves.com) —, e em
 * maiúsculas cabem no modo alfanumérico. "https://voaneves.com/" cai de 168
 * para 116 bits: são ~5 bytes a menos de URL fixa, e é exatamente a URL fixa
 * que empurrava o desenho para fora do centro. O CAMINHO não entra: o GitHub
 * Pages diferencia maiúsculas (/VOTE-PLAY/ dá 404 — também conferido).
 */
export function urlSegments(url: string): Segment[] {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+\/)(.*)$/i.exec(url);
  if (!match) return [{ mode: 'byte', data: url }];
  const head = match[1].toUpperCase();
  if (![...head].every((ch) => ALNUM.includes(ch))) return [{ mode: 'byte', data: url }];
  return match[2] ? [{ mode: 'alnum', data: head }, { mode: 'byte', data: match[2] }] : [{ mode: 'alnum', data: head }];
}

function buildMessage(
  segments: Segment[],
  ver: number,
  ecc: EccLevel,
  free: FreeBits | null,
): Message | null {
  const capacity = dataCodewords(ver, ecc) * 8;
  const ccByte = ver <= 9 ? 8 : 16;
  const ccAlnum = ver <= 9 ? 9 : 11;
  const ccNum = ver <= 9 ? 10 : 12;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push(((value >>> i) & 1) === 1 ? ONE : ZERO);
  };

  for (const seg of segments) {
    if (seg.mode === 'alnum') {
      push(0b0010, 4);
      push(seg.data.length, ccAlnum);
      for (let i = 0; i < seg.data.length; i += 2) {
        const a = ALNUM.indexOf(seg.data[i]);
        if (i + 1 < seg.data.length) push(a * 45 + ALNUM.indexOf(seg.data[i + 1]), 11);
        else push(a, 6);
      }
    } else {
      const bytes = new TextEncoder().encode(seg.data);
      push(0b0100, 4);
      push(bytes.length, ccByte);
      for (const b of bytes) push(b, 8);
    }
  }
  if (bits.length > capacity) return null;

  let freeCount = 0;
  let groups = 0;
  let digitStart = -1;
  if (free === 'fragment') {
    groups = Math.floor((capacity - bits.length - 4 - ccNum) / 10);
    if (groups * 3 >= 1 << ccNum) groups = Math.floor(((1 << ccNum) - 1) / 3);
    if (groups < 1) return null;
    push(0b0001, 4);
    push(groups * 3, ccNum);
    digitStart = bits.length;
    for (let gI = 0; gI < groups; gI++) {
      for (let i = 0; i < 10; i++) bits.push(freeCount++);
    }
  }

  // terminador e alinhamento em byte
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(ZERO);
  while (bits.length % 8 !== 0) bits.push(ZERO);

  if (free === 'padding') {
    // o leitor já parou no terminador: daqui em diante tudo é livre
    while (bits.length < capacity) bits.push(freeCount++);
    if (freeCount === 0) return null;
  } else {
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  }

  return { bits: Int32Array.from(bits), freeCount, digitGroups: groups, digitStart };
}

function messageBytes(msg: Message, x: Uint8Array | null): number[] {
  const out = new Array<number>(msg.bits.length / 8).fill(0);
  for (let i = 0; i < msg.bits.length; i++) {
    const b = msg.bits[i];
    const v = b === ONE ? 1 : b === ZERO ? 0 : (x as Uint8Array)[b];
    out[i >>> 3] |= v << (7 - (i & 7));
  }
  return out;
}

function codewordStream(data: number[], layout: BlockLayout): number[] {
  const divisor = rsDivisor(layout.eccLen);
  const blocks = layout.dataLen.map((len, b) => {
    const dat = data.slice(layout.dataOffset[b], layout.dataOffset[b] + len);
    return dat.concat(rsRemainder(dat, divisor));
  });
  return layout.stream.map(([b, i]) => blocks[b][i]);
}

function renderGrid(ver: number, ecc: EccLevel, mask: number, stream: number[]): Grid {
  const g = functionGrid(ver, ecc, mask);
  const order = placementOrder(g);
  for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    const bit = i < stream.length * 8 ? (stream[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
    const x = cell % g.size;
    const y = (cell - x) / g.size;
    g.dark[cell] = bit ^ (maskBit(mask, x, y) ? 1 : 0);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Codificação comum (sem logo) — também é o que o teste compara com a biblioteca
// ---------------------------------------------------------------------------

function penalty(g: Grid): number {
  const s = g.size;
  const at = (x: number, y: number) => g.dark[y * s + x];
  let score = 0;
  const finderLike = [1, 0, 1, 1, 1, 0, 1];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < s; a++) {
      let run = 1;
      const line: number[] = [];
      for (let b = 0; b < s; b++) line.push(pass === 0 ? at(b, a) : at(a, b));
      for (let b = 1; b <= s; b++) {
        if (b < s && line[b] === line[b - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      for (let b = 0; b + 7 <= s; b++) {
        if (!finderLike.every((v, k) => line[b + k] === v)) continue;
        const lightBefore = b >= 4 && [1, 2, 3, 4].every((k) => line[b - k] === 0);
        const lightAfter = b + 11 <= s && [7, 8, 9, 10].every((k) => line[b + k] === 0);
        if (lightBefore || lightAfter) score += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      dark += at(x, y);
      if (x + 1 < s && y + 1 < s) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
      }
    }
  }
  const total = s * s;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** QR comum em modo byte. `mask` e `version` fixam a escolha (útil para conferência); sem eles, decide sozinho. */
export function encodeText(text: string, ecc: EccLevel = 'M', mask?: number, version?: number): QrSymbol {
  const segments: Segment[] = [{ mode: 'byte', data: text }];
  for (let ver = version ?? 1; ver <= (version ?? MAX_VERSION); ver++) {
    const msg = buildMessage(segments, ver, ecc, null);
    if (!msg) continue;
    const stream = codewordStream(messageBytes(msg, null), blockLayout(ver, ecc));
    let best: Grid | null = null;
    let bestMask = 0;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      if (mask !== undefined && m !== mask) continue;
      const g = renderGrid(ver, ecc, m, stream);
      const sc = mask !== undefined ? 0 : penalty(g);
      if (sc < bestScore) [best, bestMask, bestScore] = [g, m, sc];
    }
    const g = best as Grid;
    return {
      version: ver, ecc, mask: bestMask, size: g.size, modules: g.dark,
      role: Uint8Array.from(g.isFunction), text, logoHit: 0, logoTotal: 0, logoBars: null, damage: 0,
    };
  }
  throw new Error('texto grande demais para o QR');
}

// ---------------------------------------------------------------------------
// O logo
// ---------------------------------------------------------------------------

interface Target {
  cell: number;
  dark: 0 | 1;
  weight: number;
}

/** Barra do logo em coordenadas da matriz (módulos). */
export interface LogoBar {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LogoLayout {
  targets: Target[];
  bars: LogoBar[];
  /** Deslocamento do centro do desenho em relação ao centro do código, em módulos. */
  offX: number;
  offY: number;
  /** Lado do desenho (largura = altura da barra alta), em módulos. */
  extent: number;
}

/**
 * As três barras em módulos: largura, vão e alturas na proporção do símbolo
 * (16, 28 e 40 de 40). Cada barra é uma PÍLULA (raio = meia largura), e um
 * módulo da caixa da barra é escuro se e só se o CENTRO dele cai dentro da
 * pílula. É essa a regra que deixa desenhar a pílula em vetor por cima: o
 * leitor amostra o centro do módulo, e o centro de cada módulo está do lado
 * certo da curva por construção. Em volta, um contorno claro de 1 módulo
 * separa o desenho do ruído dos dados.
 *
 * Devolve `null` se o desenho (com o contorno) sair da matriz ou encostar num
 * padrão de função — localizador, temporização ou alinhamento.
 */
function logoTargets(g: Grid, dx: number, dy: number, barW: number, gap: number): LogoLayout | null {
  const s = g.size;
  const total = barW * 3 + gap * 2;
  const heights = [Math.round(total * 0.4), Math.round(total * 0.7), total];
  const x0 = Math.floor((s - total) / 2) + dx;
  const y0 = Math.floor((s - total) / 2) + dy;
  const bottom = y0 + total; // exclusivo
  if (x0 - 1 < 0 || y0 - 1 < 0 || x0 + total + 1 > s || bottom + 1 > s) return null;

  const role = new Map<number, 0 | 1>();
  const priority = new Map<number, number>();
  const bars: LogoBar[] = [];
  const r = barW / 2;
  for (let b = 0; b < 3; b++) {
    const bx = x0 + b * (barW + gap);
    const top = bottom - heights[b];
    bars.push({ x: bx, y: top, w: barW, h: heights[b] });
    for (let y = top; y < bottom; y++) {
      for (let x = bx; x < bx + barW; x++) {
        // centro do módulo, relativo à barra
        const cx = x - bx + 0.5;
        const cy = y - top + 0.5;
        const ay = cy < r ? r : cy > heights[b] - r ? heights[b] - r : cy;
        const inside = (cx - r) ** 2 + (cy - ay) ** 2 <= r * r;
        const cell = y * s + x;
        role.set(cell, inside ? 1 : 0);
        const tip = cy < r || cy > heights[b] - r;
        // miolo da barra primeiro, pontas depois, cantos claros por último
        priority.set(cell, !inside ? 1 : tip ? 3 : 4);
      }
    }
  }
  for (const [cell, dark] of [...role]) {
    if (!dark) continue;
    const cx = cell % s;
    const cy = (cell - cx) / s;
    for (let ny = cy - 1; ny <= cy + 1; ny++) {
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        const n = ny * s + nx;
        if (!role.has(n)) {
          role.set(n, 0);
          priority.set(n, 2);
        }
      }
    }
  }

  const targets: Target[] = [];
  for (const [cell, dark] of role) {
    if (g.isFunction[cell]) return null;
    targets.push({ cell, dark, weight: priority.get(cell) as number });
  }
  // estável: mesma entrada, mesmo desenho
  targets.sort((a, b) => b.weight - a.weight || a.cell - b.cell);
  return {
    targets,
    bars,
    offX: x0 + total / 2 - s / 2,
    offY: y0 + total / 2 - s / 2,
    extent: total,
  };
}

/** Forma afim de cada bit do fluxo final: bitset de variáveis + bit constante no fim. */
function streamForms(msg: Message, layout: BlockLayout, words: number): Uint32Array[] {
  const n = msg.freeCount;
  const constWord = n >>> 5;
  const constMask = 1 << (n & 31);
  const formOfMsgBit = (bit: number) => {
    const f = new Uint32Array(words);
    const b = msg.bits[bit];
    if (b === ONE) f[constWord] |= constMask;
    else if (b >= 0) f[b >>> 5] |= 1 << (b & 31);
    return f;
  };

  const divisor = rsDivisor(layout.eccLen);
  const perBlock: Uint32Array[][] = layout.dataLen.map((len, blk) => {
    const forms: Uint32Array[] = [];
    for (let i = 0; i < len * 8; i++) forms.push(formOfMsgBit(layout.dataOffset[blk] * 8 + i));
    const eccForms = Array.from({ length: layout.eccLen * 8 }, () => new Uint32Array(words));
    const unit = new Array<number>(len).fill(0);
    for (let p = 0; p < len * 8; p++) {
      unit[p >>> 3] = 0x80 >>> (p & 7);
      const rem = rsRemainder(unit, divisor);
      unit[p >>> 3] = 0;
      const src = forms[p];
      let empty = true;
      for (let w = 0; w < words; w++) if (src[w]) { empty = false; break; }
      if (empty) continue;
      for (let e = 0; e < layout.eccLen * 8; e++) {
        if ((rem[e >>> 3] >>> (7 - (e & 7))) & 1) {
          const dst = eccForms[e];
          for (let w = 0; w < words; w++) dst[w] ^= src[w];
        }
      }
    }
    return forms.concat(eccForms);
  });

  const out: Uint32Array[] = [];
  for (const [blk, i] of layout.stream) {
    for (let k = 0; k < 8; k++) out.push(perBlock[blk][i * 8 + k]);
  }
  return out;
}

/** Variável do bit alto de cada grupo numérico que passou de 999. */
function groupsOver999(msg: Message, x: Uint8Array): number[] {
  const over: number[] = [];
  for (let gI = 0; gI < msg.digitGroups; gI++) {
    let v = 0;
    const first = msg.bits[msg.digitStart + gI * 10];
    for (let k = 0; k < 10; k++) {
      const b = msg.bits[msg.digitStart + gI * 10 + k];
      v = (v << 1) | (b === ONE ? 1 : b === ZERO ? 0 : x[b]);
    }
    if (v > 999 && first >= 0) over.push(first);
  }
  return over;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Eliminação de Gauss incremental (forma escalonada reduzida) sobre GF(2). */
function solve(
  forms: Uint32Array[],
  cellToBit: Int32Array,
  targets: Target[],
  mask: number,
  size: number,
  n: number,
  words: number,
  seed: number,
  forcedZero: number[],
): Uint8Array {
  const constWord = n >>> 5;
  const constBit = 1 << (n & 31);
  const pivotRows: Uint32Array[] = [];
  const pivotCols: number[] = [];

  const equations: Uint32Array[] = [];
  // primeiro as obrigações (grupo numérico ≤ 999), depois o desenho
  for (const v of forcedZero) {
    const row = new Uint32Array(words);
    row[v >>> 5] |= 1 << (v & 31);
    equations.push(row);
  }
  for (const t of targets) {
    const bit = cellToBit[t.cell];
    if (bit < 0) continue;
    const row = Uint32Array.from(forms[bit]);
    const x = t.cell % size;
    const y = (t.cell - x) / size;
    // forma(x) ⊕ máscara = desejado  ⇒  vars·x = desejado ⊕ máscara ⊕ constante
    if (t.dark ^ (maskBit(mask, x, y) ? 1 : 0)) row[constWord] ^= constBit;
    equations.push(row);
  }

  for (const row of equations) {
    for (let p = 0; p < pivotRows.length; p++) {
      const c = pivotCols[p];
      if ((row[c >>> 5] >>> (c & 31)) & 1) {
        const pr = pivotRows[p];
        for (let w = 0; w < words; w++) row[w] ^= pr[w];
      }
    }
    let col = -1;
    for (let w = 0; w < words && col < 0; w++) {
      let v = row[w];
      if (w === constWord) v &= constBit - 1;
      if (w > constWord) v = 0;
      if (v) col = (w << 5) + (31 - Math.clz32(v & -v));
    }
    if (col < 0) continue; // já satisfeito ou impossível; a contagem vem depois
    for (let p = 0; p < pivotRows.length; p++) {
      const pr = pivotRows[p];
      if ((pr[col >>> 5] >>> (col & 31)) & 1) for (let w = 0; w < words; w++) pr[w] ^= row[w];
    }
    pivotRows.push(row);
    pivotCols.push(col);
  }

  const rand = mulberry32(seed ^ (mask * 0x9e3779b1));
  const xs = new Uint8Array(n);
  for (let i = 0; i < n; i++) xs[i] = rand() < 0.5 ? 1 : 0;
  const isPivot = new Uint8Array(n);
  for (const c of pivotCols) isPivot[c] = 1;
  for (let p = 0; p < pivotRows.length; p++) {
    const row = pivotRows[p];
    let v = (row[constWord] & constBit) ? 1 : 0;
    for (let w = 0; w < words; w++) {
      let bits = row[w];
      if (w === constWord) bits &= constBit - 1;
      if (w > constWord) bits = 0;
      while (bits) {
        const low = bits & -bits;
        const idx = (w << 5) + (31 - Math.clz32(low));
        bits ^= low;
        if (idx !== pivotCols[p] && !isPivot[idx]) v ^= xs[idx];
      }
    }
    xs[pivotCols[p]] = v;
  }
  return xs;
}

/**
 * Largura de barra e vão, em módulos. Uma só, medida:
 * - 5 ou mais: mesmo com ZERO pontos, o zbar deixou de ler 30 de 30 códigos
 *   no limite de distância (110 px com desfoque) — área coral grande demais
 *   vira cinza quando a imagem borra;
 * - 3 (ímpar): o módulo do canto de cada ponta tem o centro dentro da pílula,
 *   mas quase toda a área fora dela; borrado, lê claro. O ZXing caiu para
 *   14 de 30 nesse limite;
 * - 4: lê igual a um QR comum nos mesmos testes.
 */
const LOGO_SPECS: ReadonlyArray<readonly [number, number]> = [[4, 2]];

/** Deslocamentos até 3 módulos, do centro para fora. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) out.push([dx, dy]);
  return out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[0] - b[0] || a[1] - b[1]);
})();

/** Bônus por nível de correção: mais correção é mais folga no bar. */
const ECC_BONUS: Record<EccLevel, number> = { L: 0, M: 4, Q: 8, H: 12 };
/** Custo de cada ponto (módulo que discorda da arte). */
const DOT_COST = 0.4;
/**
 * Teto de dano aceito (ver `QrSymbol.damage`). Medido, não chutado: com
 * 60 códigos degradados até o limite da leitura (110 px com desfoque), teto
 * 0,25 lê igual a um QR comum (60/60 no ZXing e no zbar); 0,5 cai para 36/60
 * e 1,0 para 0/60. Os pontos pequenos são os primeiros a sumir com distância
 * e desfoque, então quase toda a correção de erro tem de sobrar para o bar.
 */
const MAX_DAMAGE = 0.25;

/** Maior lado do desenho, como fração do lado do código. */
const MAX_EXTENT = 0.45;

/**
 * Nota da composição, sem contar os pontos: tamanho do desenho em relação ao
 * código (é o que faz a marca ser reconhecida de longe), distância do centro
 * (1 módulo fora custa 6 pontos na horizontal e 4 na vertical) e tamanho do
 * código (módulo menor lê de mais perto).
 */
function layoutScore(
  layout: Pick<LogoLayout, 'extent' | 'offX' | 'offY'>,
  size: number,
  ecc: EccLevel,
): number {
  return (
    (layout.extent / size) * 100 -
    Math.abs(layout.offX) * 6 -
    Math.abs(layout.offY) * 4 -
    (size - 29) * 0.5 +
    ECC_BONUS[ecc]
  );
}

/**
 * QR do show com as barras do Vote Play — desenhadas pelos dados E por cima.
 *
 * Duas técnicas juntas:
 *
 * 1. **Dados controlados (QArt).** O gerador escolhe os bits livres para que
 *    o máximo de módulos da zona do logo concorde com a arte.
 * 2. **Meio-tom (halftone, Chu et al., SIGGRAPH Asia 2013).** O leitor só
 *    amostra o CENTRO de cada módulo. A zona do logo é desenhada como arte —
 *    pílulas coral em vetor sobre branco — e cada módulo que ainda discorda
 *    vira um ponto no centro, da cor que o dado pede. Assim a marca pode ser
 *    grande e centrada mesmo onde a URL impede os dados de obedecer.
 *
 * A trava de segurança é o `damage`: os pontos só podem gastar até 25% da
 * correção de erro de cada bloco (`MAX_DAMAGE`), mesmo no pior caso de o
 * leitor errar todos. Entre as composições que passam, vence a de maior nota:
 * `layoutScore` menos o custo dos pontos. Busca em L, M e Q, versões 4 a 6 (da 7 em diante há um
 * padrão de alinhamento no centro), podando o que já não bate a melhor nota.
 */
export function encodeWithLogo(url: string, free: FreeBits = 'padding'): QrSymbol {
  const segments = urlSegments(free === 'fragment' ? `${url}#` : url);
  // o que o leitor devolve: domínio em maiúsculas, caminho intacto
  const readable = segments.map((seg) => seg.data).join('');
  // Todas as composições possíveis, da maior nota teórica para a menor. Assim
  // a primeira que passa na trava já costuma ser a vencedora, e o resto é
  // podado sem resolver nada.
  interface Candidate {
    ecc: EccLevel;
    ver: number;
    barW: number;
    gap: number;
    dx: number;
    dy: number;
    upper: number;
  }
  const candidates: Candidate[] = [];
  const messages = new Map<string, { msg: Message; base: Grid; prepared: Prepared | null }>();
  for (const ecc of ['L', 'M', 'Q'] as const) {
    for (let ver = 4; ver <= 6; ver++) {
      const msg = buildMessage(segments, ver, ecc, free);
      if (!msg) continue;
      const base = functionGrid(ver, ecc, 0);
      messages.set(`${ecc}${ver}`, { msg, base, prepared: null });
      for (const [barW, gap] of LOGO_SPECS) {
        const extent = barW * 3 + gap * 2;
        // mesma lição das barras de 5: acima de ~45% do lado, a área coral
        // começa a custar leitura de longe (medido com a URL de dev, versão 4)
        if (extent / base.size > MAX_EXTENT) continue;
        for (const [dx, dy] of OFFSETS) {
          // só a geometria: montar os alvos é caro e fica para quem for avaliado
          const x0 = Math.floor((base.size - extent) / 2) + dx;
          const y0 = Math.floor((base.size - extent) / 2) + dy;
          const offX = x0 + extent / 2 - base.size / 2;
          const offY = y0 + extent / 2 - base.size / 2;
          const upper = layoutScore({ extent, offX, offY }, base.size, ecc);
          candidates.push({ ecc, ver, barW, gap, dx, dy, upper });
        }
      }
    }
  }
  candidates.sort((a, b) => b.upper - a.upper);

  let best: QrSymbol | null = null;
  let bestScore = -Infinity;
  for (const { ecc, ver, barW, gap, dx, dy, upper } of candidates) {
    if (upper <= bestScore) break;
    const entry = messages.get(`${ecc}${ver}`) as { msg: Message; base: Grid; prepared: Prepared | null };
    const layout = logoTargets(entry.base, dx, dy, barW, gap);
    if (!layout) continue;
    entry.prepared ??= prepare(ver, ecc, entry.msg, entry.base);
    // Triagem com 1 máscara. Trocar de máscara melhora dano e pontos em ~30%,
    // não em 2× — o que já está longe com a máscara 0 não vale as outras 7.
    const quick = paint(readable, entry.prepared, layout.targets, free, 1);
    if (quick.damage > MAX_DAMAGE + 0.4) continue;
    if (upper - (quick.logoTotal - quick.logoHit) * DOT_COST * 0.6 <= bestScore) continue;
    const symbol = paint(readable, entry.prepared, layout.targets, free);
    if (symbol.damage > MAX_DAMAGE) continue;
    const score = upper - (symbol.logoTotal - symbol.logoHit) * DOT_COST;
    if (score > bestScore) {
      symbol.logoBars = layout.bars;
      best = symbol;
      bestScore = score;
    }
  }
  return best ?? encodeText(url, 'M');
}

interface Prepared {
  ver: number;
  ecc: EccLevel;
  msg: Message;
  base: Grid;
  layout: BlockLayout;
  forms: Uint32Array[];
  cellToBit: Int32Array;
  words: number;
}

/** A parte cara e independente do desenho: a forma afim de cada módulo. */
function prepare(ver: number, ecc: EccLevel, msg: Message, base: Grid): Prepared {
  const layout = blockLayout(ver, ecc);
  const words = (msg.freeCount >>> 5) + 1;
  const forms = streamForms(msg, layout, words);
  const order = placementOrder(base);
  const cellToBit = new Int32Array(base.size * base.size).fill(-1);
  for (let i = 0; i < order.length && i < forms.length; i++) cellToBit[order[i]] = i;
  return { ver, ecc, msg, base, layout, forms, cellToBit, words };
}

function paint(url: string, prep: Prepared, targets: Target[], free: FreeBits, masks = 8): QrSymbol {
  const { ver, ecc, msg, base, layout, forms, cellToBit, words } = prep;
  const n = msg.freeCount;
  const seed = hashText(url);

  let best: { grid: Grid; mask: number; x: Uint8Array; hitCount: number; hit: number; pen: number } | null =
    null;
  for (let mask = 0; mask < masks; mask++) {
    const forced: number[] = [];
    let x = solve(forms, cellToBit, targets, mask, base.size, n, words, seed, forced);
    for (let round = 0; round < 12; round++) {
      const over = groupsOver999(msg, x);
      if (over.length === 0) break;
      forced.push(...over);
      x = solve(forms, cellToBit, targets, mask, base.size, n, words, seed, forced);
    }
    if (groupsOver999(msg, x).length > 0) continue;
    const stream = codewordStream(messageBytes(msg, x), layout);
    const grid = renderGrid(ver, ecc, mask, stream);
    let hit = 0;
    let hitCount = 0;
    for (const t of targets) {
      if (grid.dark[t.cell] === t.dark) {
        hit += t.weight;
        hitCount++;
      }
    }
    // desenho primeiro; entre máscaras que o desenham igual, a de menor
    // penalidade (calculada só no empate — é cara)
    if (!best || hit > best.hit) {
      best = { grid, mask, x, hitCount, hit, pen: -1 };
    } else if (hit === best.hit) {
      if (best.pen < 0) best.pen = penalty(best.grid);
      const pen = penalty(grid);
      if (pen < best.pen) best = { grid, mask, x, hitCount, hit, pen };
    }
    if (hitCount === targets.length) break;
  }
  if (!best) return encodeText(url, 'M');
  const chosen = best;

  const role = new Uint8Array(chosen.grid.size * chosen.grid.size);
  for (let i = 0; i < role.length; i++) role[i] = chosen.grid.isFunction[i] ? ROLE_FUNCTION : ROLE_DATA;
  const touched = layout.dataLen.map(() => new Set<number>());
  for (const t of targets) {
    role[t.cell] = t.dark ? ROLE_LOGO : ROLE_HALO;
    if (chosen.grid.dark[t.cell] === t.dark) continue;
    const bit = cellToBit[t.cell];
    if (bit < 0) continue;
    const [blk, idx] = layout.stream[bit >>> 3];
    touched[blk].add(idx);
  }
  const correctable = Math.floor(layout.eccLen / 2);
  const damage = Math.max(...touched.map((set) => set.size / correctable));

  // o texto que o leitor vai ver: a URL (e, no modo fragmento, "#" + dígitos)
  let digits = '';
  const bytesOut = messageBytes(msg, chosen.x);
  const bitAt = (i: number) => (bytesOut[i >>> 3] >>> (7 - (i & 7))) & 1;
  for (let gI = 0; gI < msg.digitGroups; gI++) {
    let v = 0;
    for (let k = 0; k < 10; k++) v = (v << 1) | bitAt(msg.digitStart + gI * 10 + k);
    digits += String(v).padStart(3, '0');
  }

  return {
    version: ver,
    ecc,
    mask: chosen.mask,
    size: chosen.grid.size,
    modules: chosen.grid.dark,
    role,
    text: free === 'fragment' ? `${url}${digits}` : url, // no modo fragmento, `url` já termina em "#"
    logoHit: chosen.hitCount,
    logoTotal: targets.length,
    logoBars: null,
    damage,
  };
}
