/**
 * Código de entrada no show: 6 caracteres, alfabeto Crockford base32
 * sem I, L, O e U — evita confusão visual (I/1, O/0) e palavras acidentais.
 */
export const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_LENGTH = 6;

const AMBIGUOUS: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

/** Normaliza o que a pessoa digitou: maiúsculas, sem espaço, corrigindo ambíguos. */
export function normalizeJoinCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .split('')
    .map((c) => AMBIGUOUS[c] ?? c)
    .join('')
    .slice(0, JOIN_CODE_LENGTH);
}

export function isValidJoinCode(input: string): boolean {
  const code = normalizeJoinCode(input);
  return (
    code.length === JOIN_CODE_LENGTH &&
    code.split('').every((c) => JOIN_CODE_ALPHABET.includes(c))
  );
}

export function generateJoinCode(): string {
  let out = '';
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length];
  return out;
}
