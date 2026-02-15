import Link from 'next/link';

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Fleet Dashboard', href: '/app' },
      { label: 'Deploy Agent', href: '/app/deploy' },
      { label: 'Launch Token', href: '/app/launch' },
      { label: 'Agent Classes', href: '#classes' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'SDK Reference', href: '/docs#sdk' },
      { label: 'API Docs', href: '/docs#api-reference' },
      { label: 'GitHub', href: '#' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'X (Twitter)', href: '#' },
      { label: 'Farcaster', href: '#' },
      { label: 'Telegram', href: '#' },
      { label: 'Discord', href: '#' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of Service', href: '#' },
      { label: 'Privacy Policy', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-bg-void border-t border-border-subtle">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-eigen-violet-deep flex items-center justify-center">
                <span className="text-caption font-bold text-white leading-none">E</span>
              </div>
              <span className="font-bold text-txt-primary">EigenSwarm</span>
            </div>
            <p className="text-xs text-txt-disabled leading-relaxed">
              Autonomous market making infrastructure for the agent economy.
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-txt-disabled hover:text-txt-muted transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-border-subtle flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-txt-disabled">
            &copy; 2025 EigenSwarm. Built on Monad. Powered by nad.fun.
          </p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-txt-disabled">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
              All systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
