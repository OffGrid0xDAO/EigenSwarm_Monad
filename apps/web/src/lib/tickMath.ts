export const TICK_SPACING = 198;

export type ConcentrationPreset = 'full' | 'wide' | 'medium' | 'tight';

export const CONCENTRATION_PRESETS: Record<ConcentrationPreset, {
  label: string;
  description: string;
  tickLower: number;
  tickUpper: number;
}> = {
  full: {
    label: 'Full Range',
    description: 'Covers entire price range. No rebalancing needed.',
    tickLower: -887238,
    tickUpper: 887238,
  },
  wide: {
    label: 'Wide',
    description: '~10x price range around current price.',
    tickLower: -23166,  // ~0.1x current price
    tickUpper: 23166,   // ~10x current price
  },
  medium: {
    label: 'Medium',
    description: '~4x price range. More capital efficient.',
    tickLower: -13860,  // ~0.25x
    tickUpper: 13860,   // ~4x
  },
  tight: {
    label: 'Tight',
    description: '~2x price range. Highest efficiency but needs monitoring.',
    tickLower: -6930,   // ~0.5x
    tickUpper: 6930,    // ~2x
  },
};

// Align tick to TICK_SPACING (round towards zero)
export function alignTick(tick: number): number {
  return Math.floor(tick / TICK_SPACING) * TICK_SPACING;
}
