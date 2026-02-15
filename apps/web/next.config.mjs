/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@eigenswarm/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.ipfs.io' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: '*.cloudflare-ipfs.com' },
      { protocol: 'https', hostname: '*.pinata.cloud' },
      { protocol: 'https', hostname: 'arweave.net' },
      { protocol: 'https', hostname: '*.arweave.net' },
      { protocol: 'https', hostname: 'nadfun.xyz' },
      { protocol: 'https', hostname: '*.nadfun.xyz' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self'",
              "connect-src 'self' http://localhost:* ws://localhost:* https://*.privy.io https://auth.privy.io wss://*.privy.io https://*.up.railway.app https://cca-lite.coinbase.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.family.co https://cloudflareinsights.com https://mainnet.base.org https://rpc.monad.xyz https://*.infura.io https://*.alchemy.com wss://*.infura.io https://vitals.vercel-insights.com https://va.vercel-scripts.com",
              "frame-src https://auth.privy.io https://app.family.co https://verify.walletconnect.com https://verify.walletconnect.org",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
  async rewrites() {
    const keeperUrl = process.env.KEEPER_BACKEND_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${keeperUrl}/api/:path*`,
      },
    ];
  },
  webpack: (config) => {
    // Fix WalletConnect / MetaMask SDK / pino bundling issues
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'pino-pretty': false,
      encoding: false,
      lokijs: false,
      '@react-native-async-storage/async-storage': false,
    };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.output.crossOriginLoading = 'anonymous';
    return config;
  },
};

export default nextConfig;
