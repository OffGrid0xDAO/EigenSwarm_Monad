import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const GRID_COLORS = [
  '#a855f7', '#7c3aed', '#6d28d9', '#8b5cf6', '#c084fc',
  '#7c3aed', '#131517', '#a855f7', '#131517', '#6d28d9',
  '#131517', '#8b5cf6', '#131517', '#c084fc', '#131517',
  '#6d28d9', '#131517', '#7c3aed', '#131517', '#a855f7',
  '#c084fc', '#8b5cf6', '#6d28d9', '#7c3aed', '#a855f7',
];

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          padding: 2,
          backgroundColor: '#131517',
          borderRadius: 4,
        }}
      >
        {GRID_COLORS.map((color, i) => (
          <div
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 1,
              backgroundColor: color,
              opacity: color === '#131517' ? 0.2 : 1,
            }}
          />
        ))}
      </div>
    ),
    { ...size }
  );
}
