import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useQrDataUrl } from '@/hooks/useQrDataUrl';
import { useCountdown } from '@/hooks/useCountdown';
import { formatCents, formatClock } from '@/lib/format';
import { Button } from '@/components/ui/button';
import type { Payment } from '@/types/domain';

const POLL_INTERVAL_MS = 3000;

export default function PixPage() {
  const { code, paymentId } = useParams<{ code: string; paymentId: string }>();
  const navigate = useNavigate();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [notFound, setNotFound] = useState(false);

  const qr = useQrDataUrl(payment?.brCode ?? null, { width: 280 });
  const { secondsLeft } = useCountdown(payment?.expiresAt ?? null);

  /**
   * Polling de fallback. Na Fase 4 o webhook confirma em ~1s e o realtime avisa;
   * este loop é a rede de segurança para quando a notificação não chega.
   */
  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await api.getPaymentStatus(paymentId);
        if (cancelled) return;
        setPayment(next);
        if (next.status === 'paid') {
          toast.success('Pagamento confirmado!');
          window.setTimeout(() => navigate(`/s/${code}`), 1600);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [paymentId, code, navigate]);

  const copy = async () => {
    if (!payment?.brCode) return;
    try {
      await navigator.clipboard.writeText(payment.brCode);
      navigator.vibrate?.(12);
      toast.success('Código Pix copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o código manualmente.');
    }
  };

  if (notFound) {
    return (
      <Centered>
        <p className="text-lg font-medium">Pagamento não encontrado.</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/s/${code}`}>Voltar ao show</Link>
        </Button>
      </Centered>
    );
  }

  if (!payment) {
    return (
      <Centered>
        <p className="animate-pulse text-muted-foreground">Gerando cobrança…</p>
      </Centered>
    );
  }

  if (payment.status === 'paid') {
    return (
      <Centered>
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-success" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m5 13 4 4L19 7"
            />
          </svg>
        </div>
        <p className="mt-5 text-2xl font-bold">Pagamento confirmado</p>
        <p className="mt-1 text-muted-foreground">
          {payment.purpose === 'vote'
            ? 'Seu voto já está no placar.'
            : 'Seu pedido entrou na fila.'}
        </p>
      </Centered>
    );
  }

  const expired = payment.status === 'expired' || secondsLeft <= 0;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      <Link
        to={`/s/${code}`}
        className="vp-focus text-sm text-muted-foreground hover:text-foreground"
      >
        ← Cancelar
      </Link>

      <div className="mt-6 text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          {payment.purpose === 'vote' ? 'Voto' : 'Pedido de música'}
        </p>
        <p className="tabular mt-1 text-4xl font-bold">
          {formatCents(payment.amountCents)}
        </p>
      </div>

      {expired ? (
        <div className="vp-surface mt-8 p-8 text-center">
          <p className="font-medium">Este código Pix expirou.</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link to={`/s/${code}`}>Tentar de novo</Link>
          </Button>
        </div>
      ) : (
        <>
          <Button
            size="lg"
            onClick={copy}
            className="mt-8 h-16 w-full text-base font-semibold"
          >
            Copiar código Pix
          </Button>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Cole no app do seu banco. Expira em{' '}
            <span className="tabular font-medium text-foreground">
              {formatClock(secondsLeft)}
            </span>
          </p>

          <div className="mt-8 flex flex-col items-center">
            <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
              ou escaneie
            </p>
            {qr ? (
              <img
                src={qr}
                alt="QR Code para pagamento via Pix"
                className="rounded-xl bg-white p-3"
                width={280}
                height={280}
              />
            ) : (
              <div className="h-[280px] w-[280px] animate-pulse rounded-xl bg-muted" />
            )}
          </div>

          <p className="mt-auto pt-8 text-center text-sm text-muted-foreground">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-primary align-middle" />
            Aguardando confirmação do pagamento
          </p>
        </>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}
