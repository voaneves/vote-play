import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { env } from '@/config/env';
import Landing from '@/pages/Landing';
import ShowPage from '@/pages/ShowPage';

// Fora do caminho crítico da plateia: só baixa quando alguém realmente abre.
const PixPage = lazy(() => import('@/pages/PixPage'));
const TelaoPage = lazy(() => import('@/pages/TelaoPage'));
const PainelPage = lazy(() => import('@/pages/PainelPage'));
const NotFound = lazy(() => import('@/pages/NotFound'));

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
        {/* basename vem do Vite: '/vote-play/' no GitHub Pages, '/' em domínio próprio */}
        <BrowserRouter basename={env.basePath}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/s/:code" element={<ShowPage />} />
              <Route path="/s/:code/pix/:paymentId" element={<PixPage />} />
              <Route path="/telao/:code" element={<TelaoPage />} />
              <Route path="/painel" element={<PainelPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
