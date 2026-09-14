import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireAuth } from '@/features/auth/RequireAuth';
import PainelLayout from './PainelLayout';

/**
 * Raiz do painel do artista.
 *
 * A autenticação vive AQUI, e não no topo da aplicação, de propósito: o
 * AuthProvider importa o supabase-js inteiro (incluindo GoTrue), e montá-lo na
 * raiz colocava ~70 kB gzip no bundle de quem só quer votar. A plateia nunca
 * autentica — usa a chave anon e duas RPCs.
 */
export default function PainelRoot() {
  return (
    <AuthProvider>
      <RequireAuth>
        <PainelLayout />
      </RequireAuth>
    </AuthProvider>
  );
}
