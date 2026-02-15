import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'EigenSwarm Agent';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function EigenOGImage({ params }: { params: { id: string } }) {
  const shortId = params.id.length > 8 ? params.id.slice(0, 8) : params.id;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #131517 0%, #1a1c1f 50%, #131517 100%)',
          position: 'relative',
        }}
      >
        {/* Top purple accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: 'linear-gradient(90deg, #a855f7, #7c3aed, #6d28d9)',
            display: 'flex',
          }}
        />

        {/* Brand name */}
        <div
          style={{
            fontSize: 28,
            color: '#a855f7',
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            marginBottom: 16,
            display: 'flex',
          }}
        >
          EigenSwarm
        </div>

        {/* Eigen ID */}
        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            display: 'flex',
          }}
        >
          {`Eigen #ES-${shortId}`}
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 24,
            color: '#a1a1aa',
            marginTop: 16,
            display: 'flex',
          }}
        >
          Autonomous Market Making Agent
        </div>

        {/* Status indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 32,
            padding: '8px 20px',
            borderRadius: 20,
            border: '1px solid rgba(168, 85, 247, 0.3)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#22c55e',
              display: 'flex',
            }}
          />
          <div
            style={{
              fontSize: 16,
              color: '#a1a1aa',
              display: 'flex',
            }}
          >
            Active on Monad
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#a855f7',
              display: 'flex',
            }}
          />
          <div
            style={{
              fontSize: 16,
              color: '#71717a',
              display: 'flex',
            }}
          >
            eigenswarm.xyz
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
