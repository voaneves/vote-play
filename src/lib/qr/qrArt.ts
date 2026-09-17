/**
 * Gerador de QR Code do Vote Play, com o logo desenhado PELOS DADOS.
 *
 * A técnica é a do QArt, de Russ Cox (research.swtch.com/qart): em vez de
 * apagar módulos no centro e colar o logo por cima — gastando a correção de
 * erro —, o gerador escolhe bits livres da mensagem de modo que os próprios
 * módulos formem o desenho. O código sai 100% válido: a correção de erro fica
 * inteira para câmera ruim, luz de bar e cartão amassado.
 *
 * De onde vêm os bits livres: a URL é seguida de "#" e de uma sequência de
 * dígitos (segmento numérico). O navegador não manda o fragmento ao servidor e
 * o app o apaga da barra de endereço ao abrir (ver main.tsx). Cada grupo de 3
 * dígitos ocupa 10 bits, todos livres — com uma condição: o grupo não pode
 * passar de 999. Fixar o bit mais alto em 0 de saída resolveria, mas deixaria
 * 1 módulo em cada 10 do miolo impossível de pintar. Em vez disso o sistema é
 * resolvido com os 10 bits livres e, se algum grupo passar de 999, só o bit
 * alto DAQUELE grupo é fixado e o sistema é resolvido de novo.
 *
 * Por que dá para resolver: Reed-Solomon é linear. Todo bit do código final —
 * dado ou correção — é um XOR de bits da mensagem. Então "este módulo tem de
 * ser escuro" vira uma equação linear sobre GF(2), e o conjunto de módulos do
 * desenho vira um sistema resolvido por eliminação de Gauss. Quando uma
 * equação contradiz as anteriores, aquele módulo fica como os dados mandarem —
 * por isso os módulos mais importantes do desenho entram primeiro.
 *
 * O resto do arquivo é um codificador de QR comum (modo byte + numérico,
 * versões 1 a 20), escrito aqui para expor o que as bibliotecas escondem: a
 * posição de cada bit na matriz. A matriz foi conferida bit a bit contra a
 * biblioteca `qrcode`, com a mesma máscara (plan.md, 5.3.1).
 */

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** Papel de cada módulo na peça final — decide a cor ao desenhar. */
export const ROLE_DATA = 0;
export const ROLE_FUNCTION = 1;
/** Módulo escuro que faz parte das barras do logo. */
export const ROLE_LOGO = 2;
/** Módulo claro que contorna as barras. */
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

function buildMessage(bytes: Uint8Array, ver: number, ecc: EccLevel, withFree: boolean): Message | null {
  const capacity = dataCodewords(ver, ecc) * 8;
  const ccByte = ver <= 9 ? 8 : 16;
  const ccNum = ver <= 9 ? 10 : 12;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push(((value >>> i) & 1) === 1 ? ONE : ZERO);
  };

  push(0b0100, 4);
  push(bytes.length, ccByte);
  for (const b of bytes) push(b, 8);
  if (bits.length > capacity) return null;

  let freeCount = 0;
  let groups = 0;
  let digitStart = -1;
  if (withFree) {
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

  // terminador, alinhamento em byte e bytes de enchimento da especificação
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(ZERO);
  while (bits.length % 8 !== 0) bits.push(ZERO);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

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
  const bytes = new TextEncoder().encode(text);
  for (let ver = version ?? 1; ver <= (version ?? MAX_VERSION); ver++) {
    const msg = buildMessage(bytes, ver, ecc, false);
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
      role: Uint8Array.from(g.isFunction), text, logoHit: 0, logoTotal: 0,
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

/**
 * As três barras em módulos: largura, vão e alturas na proporção do símbolo
 * (16, 28 e 40 de 40). Com barra de 4 módulos as pontas são arredondadas — o
 * módulo do canto de cada ponta fica claro, e a barra vira pílula; com 3, um
 * canto cortado faria um lápis, então a ponta fica reta. Em volta, um contorno
 * claro de 1 módulo separa o desenho do ruído dos dados.
 *
 * `dx` desloca o desenho na horizontal. Os primeiros bytes da mensagem — a
 * URL, que não muda — ocupam as colunas da direita, e ali nenhum módulo
 * obedece; um módulo para a esquerda às vezes é o que separa um contorno
 * falhado de um desenho inteiro. Num símbolo assimétrico como as barras
 * ascendentes, 1 módulo fora do centro não se nota.
 */
function logoTargets(g: Grid, dx: number): Target[] {
  const s = g.size;
  const barW = s >= 37 ? 4 : 3;
  const gap = 2;
  const round = barW >= 4;
  const total = barW * 3 + gap * 2;
  const heights = [Math.round(total * 0.4), Math.round(total * 0.7), total];
  const x0 = Math.floor((s - total) / 2) + dx;
  const y0 = Math.floor((s - total) / 2);
  const bottom = y0 + total; // exclusivo

  const role = new Map<number, 0 | 1>();
  const priority = new Map<number, number>();
  for (let b = 0; b < 3; b++) {
    const bx = x0 + b * (barW + gap);
    const top = bottom - heights[b];
    for (let y = top; y < bottom; y++) {
      for (let x = bx; x < bx + barW; x++) {
        const tip = y === top || y === bottom - 1;
        const corner = round && tip && (x === bx || x === bx + barW - 1);
        const cell = y * s + x;
        role.set(cell, corner ? 0 : 1);
        // miolo da barra primeiro, pontas depois, cantos claros por último
        priority.set(cell, corner ? 1 : tip ? 3 : 4);
      }
    }
  }
  for (const [cell, dark] of [...role]) {
    if (!dark) continue;
    const cx = cell % s;
    const cy = (cell - cx) / s;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        const n = y * s + x;
        if (!role.has(n)) {
          role.set(n, 0);
          priority.set(n, 2);
        }
      }
    }
  }

  const targets: Target[] = [];
  for (const [cell, dark] of role) {
    if (g.isFunction[cell]) continue;
    targets.push({ cell, dark, weight: priority.get(cell) as number });
  }
  // estável: mesma entrada, mesmo desenho
  targets.sort((a, b) => b.weight - a.weight || a.cell - b.cell);
  return targets;
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

/** Fração do desenho que precisa sair certa para a peça ser aceita de cara. */
const GOOD_ENOUGH = 0.985;
/** Abaixo disto o desenho sai esburacado: melhor um QR comum. */
const ACCEPTABLE = 0.9;

/**
 * QR do show com as barras do Vote Play desenhadas pelos dados.
 *
 * Quem limita o desenho não é a quantidade de bits livres, é ONDE eles caem.
 * Os módulos de um bloco de correção só obedecem se o próprio bloco tiver
 * bits livres, e a URL enche o primeiro bloco inteiro. Então:
 *
 * - tenta M antes de L, e as versões de 3 a 6 em ordem — da 7 em diante há um
 *   padrão de alinhamento no centro exato, em cima da barra do meio;
 * - em cada uma, o desenho no centro e, se falhar, deslocado 1 ou 2 módulos;
 * - aceita a primeira que acerta ≥ 98,5% dos módulos do desenho;
 * - entre as 8 máscaras, a que mais acerta e, no empate, a de menor
 *   penalidade da especificação.
 *
 * Na prática a URL de produção (39 caracteres) sai na versão 5, nível L, em
 * bloco único: nenhum módulo é sacrificado, então a correção de 7% do L está
 * inteira — ao contrário do logo colado, que gastava a do H antes de o
 * celular ler.
 */
export function encodeWithLogo(url: string): QrSymbol {
  const bytes = new TextEncoder().encode(`${url}#`);
  let best: QrSymbol | null = null;
  for (const ecc of ['M', 'L'] as const) {
    for (let ver = 3; ver <= 6; ver++) {
      const msg = buildMessage(bytes, ver, ecc, true);
      if (!msg) continue;
      const base = functionGrid(ver, ecc, 0);
      const prepared = prepare(ver, ecc, msg, base);
      for (const dx of [0, -1, 1, -2]) {
        const targets = logoTargets(base, dx);
        if (msg.freeCount < targets.length * 1.5) break;
        const symbol = paint(url, prepared, targets);
        const ratio = symbol.logoHit / symbol.logoTotal;
        if (ratio >= GOOD_ENOUGH) return symbol;
        if (!best || ratio > best.logoHit / best.logoTotal) best = symbol;
      }
    }
  }
  if (best && best.logoHit / best.logoTotal >= ACCEPTABLE) return best;
  return encodeText(url, 'M');
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

function paint(url: string, prep: Prepared, targets: Target[]): QrSymbol {
  const { ver, ecc, msg, base, layout, forms, cellToBit, words } = prep;
  const n = msg.freeCount;
  const seed = hashText(url);

  let best: { grid: Grid; mask: number; x: Uint8Array; hitCount: number; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
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
    // desenho primeiro; entre máscaras que o desenham igual, a de menor penalidade
    const score = hit * 10_000 - penalty(grid);
    if (!best || score > best.score) best = { grid, mask, x, hitCount, score };
    if (hitCount === targets.length) break;
  }
  if (!best) return encodeText(url, 'M');
  const chosen = best;

  const role = new Uint8Array(chosen.grid.size * chosen.grid.size);
  for (let i = 0; i < role.length; i++) role[i] = chosen.grid.isFunction[i] ? ROLE_FUNCTION : ROLE_DATA;
  for (const t of targets) {
    if (chosen.grid.dark[t.cell] !== t.dark) continue;
    role[t.cell] = t.dark ? ROLE_LOGO : ROLE_HALO;
  }

  // o texto que o leitor vai ver: URL + "#" + dígitos
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
    text: `${url}#${digits}`,
    logoHit: chosen.hitCount,
    logoTotal: targets.length,
  };
}
