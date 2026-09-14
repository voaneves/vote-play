const KEY = 'vp:device';

/**
 * Identificador estável do aparelho, por navegador.
 *
 * É só um UUID aleatório guardado localmente — deliberadamente NÃO é fingerprint.
 * Serve para a mesma pessoa recuperar a própria sessão ao recarregar a página, e
 * para o servidor aplicar limite por dispositivo. Não identifica ninguém e não
 * atravessa shows diferentes de forma útil.
 */
export function getDeviceHash(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // modo privado ou storage bloqueado: sessão vira efêmera, o app segue
    return crypto.randomUUID();
  }
}
