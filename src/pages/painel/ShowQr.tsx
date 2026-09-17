import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { VotePlayQr } from '@/components/brand/VotePlayQr';
import { showJoinUrl } from '@/config/env';
import { getShow } from '@/lib/painel/queries';

/**
 * A folha que fica na mesa — e a primeira peça de marca que a plateia vê.
 *
 * Sai no papel, então fundo branco e texto preto, com o coral só nos acentos:
 * é a única tela do app que não escolhe o próprio contraste, porque quem
 * escolhe é a impressora de quem for imprimir.
 *
 * O código curto aparece tão grande quanto o QR de propósito. Quem está longe,
 * com a câmera ruim ou com o celular sem bateria para abrir a câmera digita o
 * código — é a saída que salva a noite quando o QR não coopera.
 */
export default function ShowQr() {
  const { id = '' } = useParams<{ id: string }>();
  const show = useQuery({ queryKey: ['show', id], queryFn: () => getShow(id) });
  const url = show.data ? showJoinUrl(show.data.join_code) : null;

  if (!show.data) return <p className="text-muted-foreground">Carregando…</p>;

  const rascunho = show.data.status === 'draft' || show.data.status === 'ready';

  return (
    <>
      <div className="flex items-center gap-3 print:hidden">
        <Link
          to={`/painel/shows/${id}`}
          className="vp-focus -ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="vp-focus ml-auto inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Imprimir
        </button>
      </div>

      {/*
        O aviso existe porque este QR funciona antes do show existir de verdade:
        ele é gerado a partir do código, que nasce junto com o rascunho. Quem
        testar agora vai ouvir "este show ainda não está no ar" e procurar bug
        no lugar errado — já aconteceu.
      */}
      {rascunho && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm print:hidden"
        >
          Este show ainda está em rascunho. O QR já funciona, mas quem escanear
          agora vai ver um aviso em vez da votação — coloque o show no ar antes
          de distribuir.
        </p>
      )}

      <div className="mx-auto mt-6 max-w-lg overflow-hidden rounded-2xl bg-white text-center text-black print:mt-0 print:rounded-none">
        {/* faixa coral: a marca sem gastar contraste do QR */}
        {/* rótulo escuro sobre o coral: a regra do brandkit (branco dava 3,3:1) */}
        <div className="flex items-center justify-center gap-2 bg-[#F34835] py-3 text-[#1A0B10]">
          <svg viewBox="0 0 40 40" className="h-5 w-5" aria-hidden fill="currentColor">
            <rect x="0" y="24" width="9" height="16" rx="4.5" />
            <rect x="15.5" y="12" width="9" height="28" rx="4.5" />
            <rect x="31" y="0" width="9" height="40" rx="4.5" />
          </svg>
          <span className="text-lg font-bold tracking-tight">Vote Play</span>
        </div>

        <div className="px-10 pb-10 pt-8">
          <p className="text-lg font-medium text-neutral-600">
            A próxima música é por sua conta
          </p>
          <h1 className="mt-1 text-4xl font-bold leading-tight">{show.data.title}</h1>
          {show.data.venue && (
            <p className="mt-1 text-lg text-neutral-500">{show.data.venue}</p>
          )}

          {url && (
            <VotePlayQr
              value={url}
              title={`QR Code do show ${show.data.title}`}
              className="mx-auto mt-6 w-full max-w-sm"
            />
          )}

          <p className="mt-6 text-lg text-neutral-600">
            Aponte a câmera, ou entre com o código
          </p>
          <p className="tabular mt-1 font-mono text-6xl font-bold tracking-[0.15em]">
            {show.data.join_code}
          </p>
          <p className="mt-6 break-all text-xs text-neutral-500">{url}</p>
        </div>
      </div>
    </>
  );
}
