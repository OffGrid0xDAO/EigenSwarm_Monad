'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 500 }}>Something went wrong</h2>
          <p style={{ fontSize: '0.875rem', color: '#666', maxWidth: '28rem', textAlign: 'center' }}>{error.message}</p>
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', borderRadius: '0.5rem', background: '#7B3FE4', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
