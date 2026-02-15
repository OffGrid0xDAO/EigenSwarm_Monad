import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const GRID_COLORS = [
  '#a855f7', '#7c3aed', '#6d28d9', '#8b5cf6', '#c084fc',
  '#7c3aed', '#131517', '#a855f7', '#131517', '#6d28d9',
  '#131517', '#8b5cf6', '#131517', '#c084fc', '#131517',
  '#6d28d9', '#131517', '#7c3aed', '#131517', '#a855f7',
  '#c084fc', '#8b5cf6', '#6d28d9', '#7c3aed', '#a855f7',
];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#131517',
          borderRadius: 36,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            width: 130,
            height: 130,
            gap: 4,
          }}
        >
          {GRID_COLORS.map((color, i) => (
            <div
              key={i}
              style={{
                width: 22,
                height: 22,
                borderRadius: 3,
                backgroundColor: color,
                opacity: color === '#131517' ? 0.2 : 1,
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
