import { useEffect, useState } from 'react';

interface Rendered {
  key: string;
  url: string;
}

/** Gera o QR no próprio dispositivo — sem chamada a serviço externo. */
export function useQrDataUrl(
  value: string | null,
  options: { width?: number; dark?: boolean } = {},
) {
  const { width = 320, dark = false } = options;
  const [rendered, setRendered] = useState<Rendered | null>(null);

  const key = value === null ? null : `${width}|${dark}|${value}`;

  useEffect(() => {
    if (!value || !key) return;
    let cancelled = false;
    // Import dinâmico: a biblioteca de QR só pesa no bundle de quem abre
    // a tela de pagamento ou o telão — a votação não carrega nada disso.
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, {
          width,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: dark
            ? { dark: '#FFFFFFFF', light: '#00000000' }
            : { dark: '#000000FF', light: '#FFFFFFFF' },
        }),
      )
      .then((url) => {
        if (!cancelled) setRendered({ key, url });
      })
      .catch(() => {
        if (!cancelled) setRendered(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, key, width, dark]);

  // Derivado: enquanto o QR do valor atual não ficou pronto, devolve null em vez de
  // exibir o anterior — e sem precisar limpar o estado dentro do efeito.
  return rendered && rendered.key === key ? rendered.url : null;
}
