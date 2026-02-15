import { Outlet, NavLink } from 'react-router-dom';
import { WalletConnect } from './WalletConnect';

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-app">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg-base)]/90 backdrop-blur-xl">
        <div className="header-inner flex items-center w-full">
          <div className="shrink-0">
            <NavLink
              to="/"
              className="flex items-center gap-2 no-underline text-[var(--text-primary)] hover:opacity-90 transition-opacity"
            >
              <span className="text-xl font-semibold tracking-tight text-white">nad.fun</span>
              <span className="text-zinc-500 text-sm">·</span>
              <span className="text-sm font-medium text-zinc-400">Bundler</span>
            </NavLink>
          </div>
          <nav className="flex-1 flex justify-center" aria-label="Main">
            <div className="flex rounded-[var(--radius)] bg-[var(--bg-input)]/80 p-1 border border-[var(--border)]">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-md text-sm font-medium no-underline transition-colors ${isActive ? 'bg-[var(--bg-elevated)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`
                }
              >
                Launch
              </NavLink>
              <NavLink
                to="/bundle-sell"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-md text-sm font-medium no-underline transition-colors ${isActive ? 'bg-[var(--bg-elevated)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`
                }
              >
                Bundle Sell
              </NavLink>
            </div>
          </nav>
          <div className="shrink-0 flex items-center justify-end min-w-0">
            <WalletConnect />
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
