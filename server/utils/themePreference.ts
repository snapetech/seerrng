// Stable account preferences, not a release-number reset. The adoption
// migration runs once, including installs that skip directly to a later build.
export const DEFAULT_THEME_PALETTE_ID = 'seerr';
export const THEME_PALETTE_IDS = [
  'seerr',
  'classic',
  'aurora',
  'ember',
  'lagoon',
  'orchid',
  'forest',
  'sapphire',
  'rosewood',
  'citrus',
  'arctic',
  'grape',
  'coral',
  'mint',
  'steel',
  'gold',
  'plum',
  'skyline',
  'moss',
  'flame',
  'violet',
  'ocean',
  'sietch-neon',
] as const;
export type ThemePaletteId = (typeof THEME_PALETTE_IDS)[number];
export const parseThemePalette = (value: unknown): ThemePaletteId | null =>
  typeof value === 'string' &&
  THEME_PALETTE_IDS.includes(value as ThemePaletteId)
    ? (value as ThemePaletteId)
    : null;
