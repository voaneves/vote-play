/**
 * Geração e download de CSV.
 *
 * Duas decisões que parecem detalhe e não são, porque o destino real deste
 * arquivo é o Excel de um músico brasileiro:
 *
 * 1. **Separador `;`.** O Excel em pt-BR usa a vírgula como separador decimal,
 *    então um CSV separado por vírgula abre com tudo espremido numa coluna só.
 * 2. **BOM no início.** Sem ele o Excel lê o arquivo como Latin-1 e todo acento
 *    vira caractere quebrado. `\uFEFF` custa três bytes e resolve.
 *
 * O resto é RFC 4180: aspas dobradas, e campo entre aspas quando contém
 * separador, aspas ou quebra de linha.
 */

const SEP = ';';
const BOM = '﻿';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escape(raw: string | number | null | undefined): string {
  const value = raw === null || raw === undefined ? '' : String(raw);
  return /["\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => escape(c.header)).join(SEP);
  const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(SEP));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

/** Nome de arquivo seguro em qualquer sistema, sem acento e sem espaço. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vote-play'
  );
}

/**
 * Dispara o download no navegador.
 *
 * O `revokeObjectURL` vai num `setTimeout` porque revogar no mesmo tick cancela
 * o download em alguns navegadores — o clique é assíncrono por baixo.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
