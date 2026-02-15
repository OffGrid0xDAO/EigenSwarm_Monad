import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'EigenSwarm — Autonomous Market Making Agents on Monad';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GRID_COLORS = [
  '#a855f7', '#7c3aed', '#6d28d9', '#8b5cf6', '#c084fc',
  '#7c3aed', '#131517', '#a855f7', '#131517', '#6d28d9',
  '#131517', '#8b5cf6', '#131517', '#c084fc', '#131517',
  '#6d28d9', '#131517', '#7c3aed', '#131517', '#a855f7',
  '#c084fc', '#8b5cf6', '#6d28d9', '#7c3aed', '#a855f7',
];

export default function OGImage() {
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

        {/* Grid icon */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            width: 120,
            height: 120,
            gap: 4,
            marginBottom: 32,
          }}
        >
          {GRID_COLORS.map((color, i) => (
            <div
              key={i}
              style={{
                width: 20,
                height: 20,
                borderRadius: 3,
                backgroundColor: color,
                opacity: color === '#131517' ? 0.15 : 0.9,
              }}
            />
          ))}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            display: 'flex',
          }}
        >
          EigenSwarm
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 24,
            color: '#a1a1aa',
            marginTop: 12,
            display: 'flex',
          }}
        >
          Autonomous Market Making Agents on Monad
        </div>

        {/* Bottom accent */}
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
