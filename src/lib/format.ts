const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** 500 -> "R$ 5,00" */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/** 500 -> "5" | 550 -> "5,50" — para chips de valor, sem o "R$" repetido. */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? String(cents / 100)
    : (cents / 100).toFixed(2).replace('.', ',');
}

/** 125 -> "02:05" */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
