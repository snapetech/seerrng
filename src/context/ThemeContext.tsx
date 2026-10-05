import { useUser } from '@app/hooks/useUser';
import { getAdvancedThemePreset } from '@app/utils/advancedThemePresets';
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from '@app/utils/localStorage';
import type { AdvancedThemeOverrides } from '@server/utils/advancedThemeOverrides';
import {
  ADVANCED_THEME_COLOR_TOKENS,
  getAdvancedThemeCssValue,
  validateAdvancedThemeOverrides,
} from '@server/utils/advancedThemeOverrides';
import {
  DEFAULT_THEME_PALETTE_ID,
  parseThemePalette,
} from '@server/utils/themePreference';
import axios from 'axios';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
export { DEFAULT_THEME_PALETTE_ID } from '@server/utils/themePreference';

export type ThemeMode = 'light' | 'dark';

type ThemeChrome = 'classic' | 'blackout';

export type ThemePalette = {
  id: string;
  name: string;
  swatches: string[];
  surface: ThemeScaleName;
  primary: ThemeScaleName;
  secondary: ThemeScaleName;
  chrome?: ThemeChrome;
};

export const themePalettes: ThemePalette[] = [
  {
    id: 'seerr',
    name: 'SeerrNG',
    swatches: ['#000000', '#1a3260', '#333333'],
    surface: 'gray',
    primary: 'indigo',
    secondary: 'purple',
    chrome: 'blackout',
  },
  {
    id: 'classic',
    name: 'Seerr',
    swatches: ['#1f2937', '#4f46e5', '#9333ea'],
    surface: 'gray',
    primary: 'indigo',
    secondary: 'purple',
    chrome: 'classic',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    swatches: ['#4f46e5', '#a855f7', '#14b8a6'],
    surface: 'indigo',
    primary: 'indigo',
    secondary: 'purple',
  },
  {
    id: 'ember',
    name: 'Ember',
    swatches: ['#dc2626', '#f97316', '#f59e0b'],
    surface: 'orange',
    primary: 'red',
    secondary: 'orange',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    swatches: ['#0f766e', '#0891b2', '#2563eb'],
    surface: 'teal',
    primary: 'teal',
    secondary: 'cyan',
  },
  {
    id: 'orchid',
    name: 'Orchid',
    swatches: ['#7c3aed', '#d946ef', '#ec4899'],
    surface: 'fuchsia',
    primary: 'violet',
    secondary: 'fuchsia',
  },
  {
    id: 'forest',
    name: 'Forest',
    swatches: ['#15803d', '#65a30d', '#0f766e'],
    surface: 'green',
    primary: 'green',
    secondary: 'lime',
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    swatches: ['#1d4ed8', '#0284c7', '#6366f1'],
    surface: 'blue',
    primary: 'blue',
    secondary: 'sky',
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    swatches: ['#be123c', '#db2777', '#7c2d12'],
    surface: 'rose',
    primary: 'rose',
    secondary: 'pink',
  },
  {
    id: 'citrus',
    name: 'Citrus',
    swatches: ['#ca8a04', '#84cc16', '#f97316'],
    surface: 'yellow',
    primary: 'yellow',
    secondary: 'lime',
  },
  {
    id: 'arctic',
    name: 'Arctic',
    swatches: ['#0284c7', '#64748b', '#22d3ee'],
    surface: 'slate',
    primary: 'sky',
    secondary: 'slate',
  },
  {
    id: 'grape',
    name: 'Grape',
    swatches: ['#6d28d9', '#9333ea', '#4f46e5'],
    surface: 'purple',
    primary: 'purple',
    secondary: 'violet',
  },
  {
    id: 'coral',
    name: 'Coral',
    swatches: ['#e11d48', '#fb7185', '#f97316'],
    surface: 'orange',
    primary: 'rose',
    secondary: 'orange',
  },
  {
    id: 'mint',
    name: 'Mint',
    swatches: ['#059669', '#10b981', '#06b6d4'],
    surface: 'emerald',
    primary: 'emerald',
    secondary: 'teal',
  },
  {
    id: 'steel',
    name: 'Steel',
    swatches: ['#475569', '#2563eb', '#0f766e'],
    surface: 'slate',
    primary: 'slate',
    secondary: 'blue',
  },
  {
    id: 'gold',
    name: 'Gold',
    swatches: ['#b45309', '#eab308', '#ea580c'],
    surface: 'amber',
    primary: 'amber',
    secondary: 'yellow',
  },
  {
    id: 'plum',
    name: 'Plum',
    swatches: ['#86198f', '#be185d', '#7c3aed'],
    surface: 'pink',
    primary: 'fuchsia',
    secondary: 'pink',
  },
  {
    id: 'skyline',
    name: 'Skyline',
    swatches: ['#0369a1', '#4f46e5', '#06b6d4'],
    surface: 'sky',
    primary: 'sky',
    secondary: 'indigo',
  },
  {
    id: 'moss',
    name: 'Moss',
    swatches: ['#4d7c0f', '#16a34a', '#ca8a04'],
    surface: 'lime',
    primary: 'lime',
    secondary: 'green',
  },
  {
    id: 'flame',
    name: 'Flame',
    swatches: ['#c2410c', '#dc2626', '#f59e0b'],
    surface: 'red',
    primary: 'orange',
    secondary: 'red',
  },
  {
    id: 'violet',
    name: 'Violet',
    swatches: ['#5b21b6', '#7e22ce', '#2563eb'],
    surface: 'violet',
    primary: 'violet',
    secondary: 'blue',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatches: ['#075985', '#0d9488', '#1d4ed8'],
    surface: 'cyan',
    primary: 'cyan',
    secondary: 'blue',
  },
  {
    id: 'sietch-neon',
    name: 'Sietch',
    swatches: ['#8e6036', '#43352e', '#8f5cff', '#d7ff3f'],
    surface: 'sietchSpice',
    primary: 'sietchSpice',
    secondary: 'sietchNeon',
  },
];

const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const themeScales = {
  gray: [
    '249 250 251',
    '243 244 246',
    '229 231 235',
    '209 213 219',
    '156 163 175',
    '107 114 128',
    '75 85 99',
    '55 65 81',
    '31 41 55',
    '17 24 39',
    '3 7 18',
  ],
  slate: [
    '248 250 252',
    '241 245 249',
    '226 232 240',
    '203 213 225',
    '148 163 184',
    '100 116 139',
    '71 85 105',
    '51 65 85',
    '30 41 59',
    '15 23 42',
    '2 6 23',
  ],
  red: [
    '254 242 242',
    '254 226 226',
    '254 202 202',
    '252 165 165',
    '248 113 113',
    '239 68 68',
    '220 38 38',
    '185 28 28',
    '153 27 27',
    '127 29 29',
    '69 10 10',
  ],
  orange: [
    '255 247 237',
    '255 237 213',
    '254 215 170',
    '253 186 116',
    '251 146 60',
    '249 115 22',
    '234 88 12',
    '194 65 12',
    '154 52 18',
    '124 45 18',
    '67 20 7',
  ],
  amber: [
    '255 251 235',
    '254 243 199',
    '253 230 138',
    '252 211 77',
    '251 191 36',
    '245 158 11',
    '217 119 6',
    '180 83 9',
    '146 64 14',
    '120 53 15',
    '69 26 3',
  ],
  yellow: [
    '254 252 232',
    '254 249 195',
    '254 240 138',
    '253 224 71',
    '250 204 21',
    '234 179 8',
    '202 138 4',
    '161 98 7',
    '133 77 14',
    '113 63 18',
    '66 32 6',
  ],
  lime: [
    '247 254 231',
    '236 252 203',
    '217 249 157',
    '190 242 100',
    '163 230 53',
    '132 204 22',
    '101 163 13',
    '77 124 15',
    '63 98 18',
    '54 83 20',
    '26 46 5',
  ],
  green: [
    '240 253 244',
    '220 252 231',
    '187 247 208',
    '134 239 172',
    '74 222 128',
    '34 197 94',
    '22 163 74',
    '21 128 61',
    '22 101 52',
    '20 83 45',
    '5 46 22',
  ],
  emerald: [
    '236 253 245',
    '209 250 229',
    '167 243 208',
    '110 231 183',
    '52 211 153',
    '16 185 129',
    '5 150 105',
    '4 120 87',
    '6 95 70',
    '6 78 59',
    '2 44 34',
  ],
  teal: [
    '240 253 250',
    '204 251 241',
    '153 246 228',
    '94 234 212',
    '45 212 191',
    '20 184 166',
    '13 148 136',
    '15 118 110',
    '17 94 89',
    '19 78 74',
    '4 47 46',
  ],
  cyan: [
    '236 254 255',
    '207 250 254',
    '165 243 252',
    '103 232 249',
    '34 211 238',
    '6 182 212',
    '8 145 178',
    '14 116 144',
    '21 94 117',
    '22 78 99',
    '8 51 68',
  ],
  sky: [
    '240 249 255',
    '224 242 254',
    '186 230 253',
    '125 211 252',
    '56 189 248',
    '14 165 233',
    '2 132 199',
    '3 105 161',
    '7 89 133',
    '12 74 110',
    '8 47 73',
  ],
  blue: [
    '239 246 255',
    '219 234 254',
    '191 219 254',
    '147 197 253',
    '96 165 250',
    '59 130 246',
    '37 99 235',
    '29 78 216',
    '30 64 175',
    '30 58 138',
    '23 37 84',
  ],
  indigo: [
    '238 242 255',
    '224 231 255',
    '199 210 254',
    '165 180 252',
    '129 140 248',
    '99 102 241',
    '79 70 229',
    '67 56 202',
    '55 48 163',
    '49 46 129',
    '30 27 75',
  ],
  violet: [
    '245 243 255',
    '237 233 254',
    '221 214 254',
    '196 181 253',
    '167 139 250',
    '139 92 246',
    '124 58 237',
    '109 40 217',
    '91 33 182',
    '76 29 149',
    '46 16 101',
  ],
  purple: [
    '250 245 255',
    '243 232 255',
    '233 213 255',
    '216 180 254',
    '192 132 252',
    '168 85 247',
    '147 51 234',
    '126 34 206',
    '107 33 168',
    '88 28 135',
    '59 7 100',
  ],
  fuchsia: [
    '253 244 255',
    '250 232 255',
    '245 208 254',
    '240 171 252',
    '232 121 249',
    '217 70 239',
    '192 38 211',
    '162 28 175',
    '134 25 143',
    '112 26 117',
    '74 4 78',
  ],
  pink: [
    '253 242 248',
    '252 231 243',
    '251 207 232',
    '249 168 212',
    '244 114 182',
    '236 72 153',
    '219 39 119',
    '190 24 93',
    '157 23 77',
    '131 24 67',
    '80 7 36',
  ],
  rose: [
    '255 241 242',
    '255 228 230',
    '254 205 211',
    '253 164 175',
    '251 113 133',
    '244 63 94',
    '225 29 72',
    '190 18 60',
    '159 18 57',
    '136 19 55',
    '76 5 25',
  ],
  sietchNeon: [
    '250 246 255',
    '240 232 255',
    '222 207 255',
    '199 171 255',
    '174 128 255',
    '143 92 255',
    '124 58 237',
    '104 39 196',
    '79 30 142',
    '55 25 94',
    '31 18 46',
  ],
  sietchSpice: [
    '251 247 239',
    '242 232 217',
    '222 203 178',
    '198 166 128',
    '170 128 83',
    '142 96 54',
    '116 75 43',
    '91 62 45',
    '67 53 46',
    '58 45 32',
    '35 27 20',
  ],
} as const;

type ThemeScaleName = keyof typeof themeScales;

const applyScale = (
  root: HTMLElement,
  target: 'gray' | 'indigo' | 'purple',
  scale: readonly string[]
) => {
  shades.forEach((shade, index) => {
    root.style.setProperty(`--color-${target}-${shade}`, scale[index]);
  });
};

type ThemeChromeTokens = {
  pageBg: string;
  pageGlowStart: string;
  pageGlowEnd: string;
  pageSpotlightCenter: string;
  pageSpotlightEdge: string;
  pageGradientLight: string;
  pageGradientMain: string;
  pageGradientDeep: string;
  pageGradientBlack: string;
  searchbarScrolled: string;
  sidebarStart: string;
  sidebarEnd: string;
  sidebarBorder: string;
  sidebarHover: string;
  controlSurface: string;
  controlSurfaceHover: string;
  controlBorder: string;
  controlText: string;
  headingText: string;
};

type ThemeArtworkTokens = {
  artworkScrim: string;
  artworkGradientLight: string;
  artworkGradientMain: string;
  artworkGradientDeep: string;
  artworkGradientBlack: string;
  artworkText: string;
};

const applyThemeChrome = (
  root: HTMLElement,
  theme: ThemeChromeTokens & ThemeArtworkTokens
) => {
  root.style.setProperty('--theme-page-bg', theme.pageBg);
  root.style.setProperty('--theme-page-glow-start', theme.pageGlowStart);
  root.style.setProperty('--theme-page-glow-end', theme.pageGlowEnd);
  root.style.setProperty(
    '--theme-page-spotlight-center',
    theme.pageSpotlightCenter
  );
  root.style.setProperty(
    '--theme-page-spotlight-edge',
    theme.pageSpotlightEdge
  );
  root.style.setProperty(
    '--theme-page-gradient-light',
    theme.pageGradientLight
  );
  root.style.setProperty('--theme-page-gradient-main', theme.pageGradientMain);
  root.style.setProperty('--theme-page-gradient-deep', theme.pageGradientDeep);
  root.style.setProperty(
    '--theme-page-gradient-black',
    theme.pageGradientBlack
  );
  root.style.setProperty('--theme-searchbar-scrolled', theme.searchbarScrolled);
  root.style.setProperty('--theme-sidebar-start', theme.sidebarStart);
  root.style.setProperty('--theme-sidebar-end', theme.sidebarEnd);
  root.style.setProperty('--theme-sidebar-border', theme.sidebarBorder);
  root.style.setProperty('--theme-sidebar-hover', theme.sidebarHover);
  root.style.setProperty('--theme-control-surface', theme.controlSurface);
  root.style.setProperty(
    '--theme-control-surface-hover',
    theme.controlSurfaceHover
  );
  root.style.setProperty('--theme-control-border', theme.controlBorder);
  root.style.setProperty('--theme-control-text', theme.controlText);
  root.style.setProperty('--theme-heading-text', theme.headingText);
  root.style.setProperty('--theme-artwork-scrim', theme.artworkScrim);
  root.style.setProperty(
    '--theme-artwork-gradient-light',
    theme.artworkGradientLight
  );
  root.style.setProperty(
    '--theme-artwork-gradient-main',
    theme.artworkGradientMain
  );
  root.style.setProperty(
    '--theme-artwork-gradient-deep',
    theme.artworkGradientDeep
  );
  root.style.setProperty(
    '--theme-artwork-gradient-black',
    theme.artworkGradientBlack
  );
  root.style.setProperty('--theme-artwork-text', theme.artworkText);
};

const parseRgb = (value: string): [number, number, number] =>
  value.split(' ').map((part) => Number(part)) as [number, number, number];

const mixRgb = (from: string, to: string, amount: number): string => {
  const fromRgb = parseRgb(from);
  const toRgb = parseRgb(to);

  return fromRgb
    .map((channel, index) =>
      Math.round(channel * (1 - amount) + toRgb[index] * amount)
    )
    .join(' ');
};

const rgbToHex = (value: string): string =>
  `#${parseRgb(value)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;

const createSurfaceScale = (
  surfaceScale: readonly string[],
  accentScale: readonly string[],
  secondaryScale: readonly string[],
  mode: ThemeMode
): string[] => {
  if (mode === 'dark') {
    const slateMix = [
      0.03, 0.04, 0.06, 0.08, 0.12, 0.16, 0.22, 0.28, 0.34, 0.38, 0.42,
    ];
    const accentMix = [
      0.08, 0.1, 0.12, 0.16, 0.2, 0.24, 0.3, 0.36, 0.42, 0.48, 0.52,
    ];

    return surfaceScale.map((surface, index) =>
      mixRgb(
        mixRgb(surface, themeScales.slate[index], slateMix[index]),
        accentScale[index],
        accentMix[index]
      )
    );
  }

  const reversedSurfaceScale = [...surfaceScale].reverse();
  const reversedSecondaryScale = [...secondaryScale].reverse();
  const slateMix = [
    0.1, 0.12, 0.14, 0.18, 0.22, 0.24, 0.2, 0.16, 0.12, 0.08, 0.04,
  ];
  const accentMix = [
    0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.18, 0.16, 0.14, 0.12, 0.1,
  ];

  return reversedSurfaceScale.map((surface, index) =>
    mixRgb(
      mixRgb(surface, themeScales.slate[index], slateMix[index]),
      reversedSecondaryScale[index],
      accentMix[index]
    )
  );
};

const getThemeChromeTokens = (
  surfaceScale: readonly string[],
  primaryScale: readonly string[],
  secondaryScale: readonly string[],
  mode: ThemeMode,
  chrome?: ThemeChrome
): ThemeChromeTokens => {
  const blackout = chrome === 'blackout';
  const classicDark =
    mode === 'dark' && (chrome === 'classic' || chrome === 'blackout');
  const pageBg = surfaceScale[9];
  const pageGlowStart = classicDark
    ? surfaceScale[8]
    : mode === 'dark'
      ? mixRgb(surfaceScale[8], primaryScale[7], 0.56)
      : mixRgb(surfaceScale[8], primaryScale[3], 0.44);
  const pageGlowEnd = surfaceScale[9];
  const searchbarScrolled = blackout
    ? '0 0 0'
    : classicDark
      ? surfaceScale[7]
      : mode === 'dark'
        ? mixRgb(surfaceScale[8], primaryScale[7], 0.44)
        : mixRgb(surfaceScale[8], primaryScale[2], 0.38);
  const sidebarStart = blackout
    ? '0 0 0'
    : classicDark
      ? surfaceScale[8]
      : mode === 'dark'
        ? mixRgb(surfaceScale[8], primaryScale[8], 0.58)
        : mixRgb(primaryScale[7], surfaceScale[2], 0.24);
  const sidebarEnd = blackout
    ? '0 0 0'
    : classicDark
      ? '19 25 40'
      : mode === 'dark'
        ? mixRgb(surfaceScale[10], primaryScale[9], 0.52)
        : mixRgb(primaryScale[9], surfaceScale[1], 0.18);
  const sidebarBorder = classicDark
    ? surfaceScale[7]
    : mode === 'dark'
      ? mixRgb(surfaceScale[7], secondaryScale[6], 0.48)
      : mixRgb(primaryScale[6], secondaryScale[6], 0.42);
  const sidebarHover = classicDark
    ? surfaceScale[7]
    : mode === 'dark'
      ? mixRgb(surfaceScale[7], primaryScale[7], 0.52)
      : mixRgb(primaryScale[6], secondaryScale[5], 0.32);

  const pageSpotlightCenter = classicDark
    ? '194 169 255'
    : mode === 'dark'
      ? mixRgb(primaryScale[2], secondaryScale[2], 0.5)
      : mixRgb(primaryScale[1], secondaryScale[1], 0.5);
  const pageSpotlightEdge = classicDark
    ? '151 115 246'
    : mode === 'dark'
      ? mixRgb(primaryScale[4], secondaryScale[4], 0.5)
      : mixRgb(primaryScale[2], secondaryScale[2], 0.5);

  const pageGradientLight = blackout
    ? '0 0 0'
    : classicDark
      ? '76 67 189'
      : mode === 'dark'
        ? mixRgb(pageGlowStart, primaryScale[6], 0.18)
        : pageGlowStart;
  const pageGradientMain = blackout
    ? '40 68 120'
    : classicDark
      ? '52 51 157'
      : mode === 'dark'
        ? mixRgb(pageBg, primaryScale[8], 0.35)
        : mixRgb(pageBg, pageGlowStart, 0.2);
  const pageGradientDeep = blackout
    ? '14 28 58'
    : classicDark
      ? '23 29 89'
      : mode === 'dark'
        ? mixRgb(surfaceScale[10], primaryScale[9], 0.42)
        : mixRgb(pageBg, surfaceScale[8], 0.2);
  const pageGradientBlack =
    blackout || classicDark || mode === 'dark' ? '0 0 0' : pageBg;

  const controlSurface = blackout
    ? '0 0 0'
    : classicDark
      ? '49 46 129'
      : mode === 'dark'
        ? mixRgb(surfaceScale[8], primaryScale[9], 0.18)
        : mixRgb(surfaceScale[9], secondaryScale[0], 0.12);
  const controlSurfaceHover = blackout
    ? '0 0 0'
    : classicDark
      ? '55 48 163'
      : mode === 'dark'
        ? mixRgb(surfaceScale[7], primaryScale[8], 0.18)
        : mixRgb(surfaceScale[8], secondaryScale[0], 0.1);
  const controlBorder = classicDark ? '99 102 241' : primaryScale[5];
  const controlText =
    blackout || classicDark
      ? '199 210 254'
      : mode === 'dark'
        ? primaryScale[2]
        : mixRgb(surfaceScale[2], primaryScale[9], 0.12);
  const headingText =
    blackout || mode === 'dark'
      ? '255 255 255'
      : mixRgb(surfaceScale[1], primaryScale[9], 0.12);

  return {
    pageBg,
    pageGlowStart,
    pageGlowEnd,
    pageSpotlightCenter,
    pageSpotlightEdge,
    pageGradientLight,
    pageGradientMain,
    pageGradientDeep,
    pageGradientBlack,
    searchbarScrolled,
    sidebarStart,
    sidebarEnd,
    sidebarBorder,
    sidebarHover,
    controlSurface,
    controlSurfaceHover,
    controlBorder,
    controlText,
    headingText,
  };
};

type ThemeContextValue = {
  mode: ThemeMode;
  palette: string;
  advancedThemeOverrides: AdvancedThemeOverrides | null;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: string) => Promise<void>;
  toggleMode: () => void;
  saveAdvancedThemeOverrides: (
    overrides: AdvancedThemeOverrides | null
  ) => Promise<void>;
};

const THEME_MODE_KEY = 'seerr-theme-mode';
const THEME_PALETTE_KEY = 'seerr-theme-palette';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getStoredMode = (): ThemeMode => {
  const storedMode = readLocalStorageValue(THEME_MODE_KEY);
  return storedMode === 'light' || storedMode === 'dark' ? storedMode : 'dark';
};

const getThemePalette = (palette: string): ThemePalette =>
  themePalettes.find((themePalette) => themePalette.id === palette) ??
  themePalettes.find(
    (themePalette) => themePalette.id === DEFAULT_THEME_PALETTE_ID
  ) ??
  themePalettes[0];

const advancedThemeTokens = [
  ...ADVANCED_THEME_COLOR_TOKENS,
  '--theme-page-spotlight-strength',
  '--theme-page-gradient-main-stop',
  '--theme-detail-divider-shadow',
];

const applyAdvancedThemeOverrides = (
  root: HTMLElement,
  overrides: AdvancedThemeOverrides | null,
  mode: ThemeMode
) => {
  const validation = validateAdvancedThemeOverrides(overrides);
  if ('error' in validation || !validation.value) return;

  const preset = getAdvancedThemePreset(validation.value.preset);
  if (preset) {
    root.dataset.themePreset = preset.id;
    Object.entries(preset.chromeByMode[mode]).forEach(([token, value]) => {
      if (value !== undefined) {
        root.style.setProperty(token, getAdvancedThemeCssValue(token, value));
      }
    });
  } else {
    delete root.dataset.themePreset;
  }

  Object.entries(validation.value).forEach(([token, value]) => {
    if (token === 'preset') return;
    root.style.setProperty(token, getAdvancedThemeCssValue(token, value));
  });
};

const resetAdvancedThemeOverrides = (root: HTMLElement) => {
  advancedThemeTokens.forEach((token) => root.style.removeProperty(token));
  delete root.dataset.themePreset;
};

export const getThemeTokens = (mode: ThemeMode, palette: string) => {
  const activePalette = getThemePalette(palette);
  const primaryScale = themeScales[activePalette.primary];
  const secondaryScale = themeScales[activePalette.secondary];
  const surfaceScale =
    mode === 'dark' &&
    (activePalette.chrome === 'classic' || activePalette.chrome === 'blackout')
      ? themeScales.gray
      : createSurfaceScale(
          themeScales[activePalette.surface],
          primaryScale,
          secondaryScale,
          mode
        );
  const chromeTokens = getThemeChromeTokens(
    surfaceScale,
    primaryScale,
    secondaryScale,
    mode,
    activePalette.chrome
  );
  const darkSurfaceScale =
    mode === 'dark'
      ? surfaceScale
      : activePalette.chrome === 'classic' ||
          activePalette.chrome === 'blackout'
        ? themeScales.gray
        : createSurfaceScale(
            themeScales[activePalette.surface],
            primaryScale,
            secondaryScale,
            'dark'
          );
  const darkChromeTokens =
    mode === 'dark'
      ? chromeTokens
      : getThemeChromeTokens(
          darkSurfaceScale,
          primaryScale,
          secondaryScale,
          'dark',
          activePalette.chrome
        );

  return {
    activePaletteId: activePalette.id,
    primaryScale,
    secondaryScale,
    surfaceScale,
    chrome: activePalette.chrome,
    ...chromeTokens,
    artworkScrim:
      activePalette.chrome === 'blackout'
        ? '0 0 0'
        : darkChromeTokens.pageGradientMain,
    artworkGradientLight:
      activePalette.chrome === 'blackout'
        ? '0 0 0'
        : darkChromeTokens.pageGradientLight,
    artworkGradientMain:
      activePalette.chrome === 'blackout'
        ? '0 0 0'
        : darkChromeTokens.pageGradientMain,
    artworkGradientDeep:
      activePalette.chrome === 'blackout'
        ? '0 0 0'
        : darkChromeTokens.pageGradientDeep,
    artworkGradientBlack: '0 0 0',
    artworkText: primaryScale[2],
  };
};

const applyTheme = (
  mode: ThemeMode,
  palette: string,
  overrides: AdvancedThemeOverrides | null = null
) => {
  if (typeof window === 'undefined') {
    return;
  }

  const themeTokens = getThemeTokens(mode, palette);

  resetAdvancedThemeOverrides(document.documentElement);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.themePalette = themeTokens.activePaletteId;
  document.documentElement.classList.toggle('dark', mode === 'dark');

  applyScale(document.documentElement, 'indigo', themeTokens.primaryScale);
  applyScale(document.documentElement, 'purple', themeTokens.secondaryScale);
  applyScale(document.documentElement, 'gray', themeTokens.surfaceScale);
  applyThemeChrome(document.documentElement, themeTokens);
  applyAdvancedThemeOverrides(document.documentElement, overrides, mode);
  const presetSidebarStart = getAdvancedThemePreset(overrides?.preset)
    ?.chromeByMode[mode]['--theme-sidebar-start'];
  const sidebarStartOverride =
    overrides?.['--theme-sidebar-start'] ?? presetSidebarStart;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      rgbToHex(
        sidebarStartOverride !== undefined
          ? getAdvancedThemeCssValue(
              '--theme-sidebar-start',
              sidebarStartOverride
            )
          : themeTokens.sidebarStart
      )
    );
  writeLocalStorageValue(THEME_MODE_KEY, mode);
  writeLocalStorageValue(THEME_PALETTE_KEY, themeTokens.activePaletteId);
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // The server and the client's first render must use the same values. Restore
  // browser preferences only after hydration to avoid replacing the SSR tree.
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [palette, setPaletteState] = useState(DEFAULT_THEME_PALETTE_ID);
  const [advancedThemeOverrides, setAdvancedThemeOverrides] =
    useState<AdvancedThemeOverrides | null>(null);
  const hasRestoredTheme = useRef(false);
  const { user, revalidate } = useUser();
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const themeSaveActive = useRef(false);

  useEffect(() => {
    const validation = validateAdvancedThemeOverrides(
      user?.settings?.advancedThemeOverrides ?? null
    );
    const savedOverrides = 'error' in validation ? null : validation.value;
    const savedPalette =
      parseThemePalette(user?.settings?.themePalette) ??
      DEFAULT_THEME_PALETTE_ID;
    const restoredMode = hasRestoredTheme.current
      ? currentMode.current
      : getStoredMode();
    // Old browser palettes must not override the one-time account migration.
    // Later logins and releases restore the user's newly saved account choice.
    hasRestoredTheme.current = true;
    setModeState(restoredMode);
    setPaletteState(savedPalette);
    setAdvancedThemeOverrides(savedOverrides);
    applyTheme(restoredMode, savedPalette, savedOverrides);
  }, [
    user?.id,
    user?.settings?.themePalette,
    user?.settings?.advancedThemeOverrides,
  ]);

  useEffect(() => {
    if (!hasRestoredTheme.current) {
      return;
    }

    applyTheme(mode, palette, advancedThemeOverrides);
  }, [mode, palette, advancedThemeOverrides]);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      setModeState(nextMode);
      applyTheme(nextMode, palette, advancedThemeOverrides);
    },
    [palette, advancedThemeOverrides]
  );

  const setPalette = useCallback(
    async (nextPalette: string) => {
      const userId = user?.id;
      const selectedPalette = parseThemePalette(nextPalette);
      if (!userId || !selectedPalette || themeSaveActive.current) {
        throw new Error(
          'Sign in and choose a valid theme after the current save finishes.'
        );
      }
      themeSaveActive.current = true;
      try {
        const { data } = await axios.post<{ themePalette: string }>(
          `/api/v1/user/${userId}/settings/theme`,
          { palette: selectedPalette }
        );
        if (data.themePalette !== selectedPalette)
          throw new Error('Theme preference was not confirmed.');
        // A delayed response from a previous login must not affect another user.
        if (currentUserId.current !== userId) return;
        setPaletteState(selectedPalette);
        await revalidate(
          (currentUser) =>
            currentUser?.id === userId
              ? {
                  ...currentUser,
                  settings: {
                    ...currentUser.settings,
                    notificationTypes:
                      currentUser.settings?.notificationTypes ?? {},
                    themePalette: selectedPalette,
                  },
                }
              : currentUser,
          false
        );
      } finally {
        themeSaveActive.current = false;
      }
    },
    [revalidate, user?.id]
  );

  const toggleMode = useCallback(() => {
    setModeState((currentMode) => {
      const nextMode = currentMode === 'dark' ? 'light' : 'dark';

      applyTheme(nextMode, palette, advancedThemeOverrides);

      return nextMode;
    });
  }, [palette, advancedThemeOverrides]);

  const saveAdvancedThemeOverrides = useCallback(
    async (overrides: AdvancedThemeOverrides | null) => {
      if (!user?.id) {
        throw new Error('Sign in to save advanced theme settings.');
      }

      const validation = validateAdvancedThemeOverrides(overrides);
      if ('error' in validation) {
        throw new Error(validation.error);
      }

      const { data } = await axios.post<{
        advancedThemeOverrides: AdvancedThemeOverrides | null;
      }>(`/api/v1/user/${user.id}/settings/advanced-theme`, {
        overrides: validation.value,
      });

      setAdvancedThemeOverrides(data.advancedThemeOverrides);
      applyTheme(mode, palette, data.advancedThemeOverrides);
      await revalidate(
        (currentUser) =>
          currentUser
            ? {
                ...currentUser,
                settings: {
                  ...currentUser.settings,
                  notificationTypes:
                    currentUser.settings?.notificationTypes ?? {},
                  advancedThemeOverrides: data.advancedThemeOverrides,
                },
              }
            : currentUser,
        false
      );
    },
    [mode, palette, revalidate, user?.id]
  );

  const value = useMemo(
    () => ({
      mode,
      palette,
      advancedThemeOverrides,
      setMode,
      setPalette,
      toggleMode,
      saveAdvancedThemeOverrides,
    }),
    [
      mode,
      palette,
      advancedThemeOverrides,
      setMode,
      setPalette,
      toggleMode,
      saveAdvancedThemeOverrides,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const themeContext = useContext(ThemeContext);

  if (!themeContext) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return themeContext;
};
