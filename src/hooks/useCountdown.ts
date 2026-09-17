import { useEffect, useState } from 'react';

/**
 * Cronômetro baseado no relógio do SERVIDOR.
 * Contador local por celular dessincronizaria a plateia inteira; a fonte da verdade
 * é `closesAt`, corrigido pelo offset do relógio do servidor.
 *
 * `secondsLeft` é derivado a cada render em vez de guardado em estado: assim uma mudança
 * de rodada aparece na hora, sem o render em cascata de um setState dentro do efeito.
 */
export function useCountdown(closesAt: string | null, clockOffsetMs = 0) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!closesAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [closesAt]);

  const secondsLeft = computeSeconds(closesAt, clockOffsetMs, now);

  return {
    secondsLeft,
    isRunningOut: secondsLeft > 0 && secondsLeft <= 60,
    hasEnded: closesAt !== null && secondsLeft <= 0,
  };
}

function computeSeconds(closesAt: string | null, offsetMs: number, now: number): number {
  if (!closesAt) return 0;
  return Math.max(0, Math.round((new Date(closesAt).getTime() - (now + offsetMs)) / 1000));
}
