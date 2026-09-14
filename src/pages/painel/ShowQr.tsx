import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useQrDataUrl } from '@/hooks/useQrDataUrl';
import { showJoinUrl } from '@/config/env';
import { getShow } from '@/lib/painel/queries';

/**
 * Folha para imprimir e deixar nas mesas.
 * Fundo branco e tinta preta de propósito: é o único lugar do app que sai no papel.
 */
export default function ShowQr() {
  const { id = '' } = useParams<{ id: string }>();
  const show = useQuery({ queryKey: ['show', id], queryFn: () => getShow(id) });
  const url = show.data ? showJoinUrl(show.data.join_code) : null;
  const qr = useQrDataUrl(url, { width: 640 });

  if (!show.data) return <p className="text-muted-foreground">Carregando…</p>;

  return (
    <>
      <div className="flex items-center gap-3 print:hidden">
        <Link
          to={`/painel/shows/${id}`}
          className="vp-focus text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="vp-focus ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Imprimir
        </button>
      </div>

      <div className="mx-auto mt-6 max-w-lg rounded-2xl bg-white p-10 text-center text-black print:mt-0 print:rounded-none print:p-0">
        <p className="text-lg font-medium text-neutral-600">A próxima música é por sua conta</p>
        <h1 className="mt-1 text-4xl font-bold">{show.data.title}</h1>

        {qr && <img src={qr} alt="" width={640} height={640} className="mx-auto mt-6 w-full max-w-sm" />}

        <p className="mt-6 text-lg text-neutral-600">Aponte a câmera, ou entre com o código</p>
        <p className="tabular mt-1 font-mono text-6xl font-bold tracking-[0.15em]">
          {show.data.join_code}
        </p>
        <p className="mt-6 break-all text-xs text-neutral-500">{url}</p>
      </div>
    </>
  );
}
