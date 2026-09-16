import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OfflineBanner } from '@/components/OfflineBanner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { env } from '@/config/env';
import Landing from '@/pages/Landing';
import ShowPage from '@/pages/ShowPage';

// Fora do caminho crítico da plateia: só baixa quando alguém realmente abre.
const PixPage = lazy(() => import('@/pages/PixPage'));
const TelaoPage = lazy(() => import('@/pages/TelaoPage'));
const NotFound = lazy(() => import('@/pages/NotFound'));

// O painel inteiro é do artista — a plateia nunca carrega esse código,
// nem o supabase-js com GoTrue que ele arrasta junto.
const PainelRoot = lazy(() => import('@/pages/painel/PainelRoot'));
const Shows = lazy(() => import('@/pages/painel/Shows'));
const ShowLive = lazy(() => import('@/pages/painel/ShowLive'));
const ShowQr = lazy(() => import('@/pages/painel/ShowQr'));
const Repertoire = lazy(() => import('@/pages/painel/Repertoire'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RouteFallback() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <p className="animate-pulse text-muted-foreground">Carregando…</p>
    </main>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster position="top-center" richColors />
        <OfflineBanner />
        {/* basename vem do Vite: '/vote-play/' no GitHub Pages, '/' em domínio próprio */}
        <BrowserRouter basename={env.basePath}>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/s/:code" element={<ShowPage />} />
              <Route path="/s/:code/pix/:paymentId" element={<PixPage />} />
              <Route path="/telao/:code" element={<TelaoPage />} />

              <Route path="/painel" element={<PainelRoot />}>
                <Route index element={<Shows />} />
                <Route path="repertorio" element={<Repertoire />} />
                <Route path="shows/:id" element={<ShowLive />} />
                <Route path="shows/:id/qr" element={<ShowQr />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
