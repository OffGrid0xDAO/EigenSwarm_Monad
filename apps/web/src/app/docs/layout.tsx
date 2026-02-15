import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Documentation — Protocol Guide & API Reference',
  description:
    'Complete guide to EigenSwarm protocol: agent deployment, LP pool mechanics, fee structure, API reference, and integration guides for autonomous market making on Monad.',
  alternates: {
    canonical: 'https://eigenswarm.xyz/docs',
  },
  openGraph: {
    title: 'Documentation — Protocol Guide & API Reference',
    description:
      'Complete guide to EigenSwarm protocol: agent deployment, LP pool mechanics, fee structure, API reference, and integration guides for autonomous market making on Monad.',
    url: 'https://eigenswarm.xyz/docs',
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
