import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/context';
import { cn } from '@/lib/utils';
import { VotePlayLogo } from '@/components/brand/VotePlayLogo';

export default function PainelLayout() {
  const { email, signOut } = useAuth();

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'vp-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition',
      isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/painel" className="vp-focus inline-flex min-h-11 items-center gap-2 font-bold">
            <VotePlayLogo className="h-5 w-5" />
            Vote Play
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/painel" end className={tab}>
              Shows
            </NavLink>
            <NavLink to="/painel/repertorio" className={tab}>
              Repertório
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="vp-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
