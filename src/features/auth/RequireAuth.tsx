import type { ReactNode } from 'react';
import { useAuth } from './context';
import SignIn from '@/pages/painel/SignIn';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-6">
        <p className="animate-pulse text-muted-foreground">Verificando sessão…</p>
      </main>
    );
  }
  if (status === 'signed-out') return <SignIn />;
  return <>{children}</>;
}
