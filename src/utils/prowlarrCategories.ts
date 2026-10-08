import type { MediaCategoryKey } from '@server/constants/mediaCategories';

export interface AdvertisedProwlarrCategory {
  id: number;
  name: string;
}

const normalizeCategoryName = (name: string) =>
  name
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const categoryMatchers: Record<MediaCategoryKey, RegExp> = {
  movie: /^(?:movies?|films?)$/,
  tv: /^(?:tv|television)$/,
  music: /^music$/,
  ebook: /^(?:e\s?books?|electronic books?)$/,
  audiobook: /^(?:audio\s?books?|spoken books?)$/,
  comic: /^(?:comics?|manga|graphic novels?)$/,
  magazine: /^(?:mags?|magazines?|periodicals?|journals?)$/,
  sports: /^(?:sports?|tv sports?)$/,
  retro:
    /^(?:nes|nintendo entertainment system|snes|super nintendo|nintendo ds|nds|nintendo 3ds|3ds|game boy(?: color| advance)?|gameboy(?: color| advance)?|gba|gamecube|game cube|nintendo 64|n64|psp|ps vita|playstation vita|playstation 3|ps3|playstation 2|ps2|playstation 1|ps1|wii|wiiware|wii u|xbox 360|sega genesis|mega drive|sega saturn|saturn|sega dreamcast|dreamcast|sega master system|master system|atari (?:2600|5200|7800|lynx|jaguar)|commodore 64)(?: roms?)?$/,
  modern:
    /^(?:nintendo switch(?: 2)?|switch(?: 2)?|playstation 4|playstation 5|ps4|ps5|xbox one|xbox series(?: x| s)?)(?: roms?)?$/,
  game: /^(?:pc|computer) games?$/,
};

/**
 * Return custom Prowlarr category IDs whose advertised names clearly identify
 * the selected medium. Standard Newznab/Torznab categories are already in the
 * defaults; ambiguous custom labels are intentionally left for manual review.
 */
export const detectProwlarrCategoryMatches = (
  category: MediaCategoryKey,
  advertisedCategories: AdvertisedProwlarrCategory[]
): number[] =>
  [
    ...new Set(
      advertisedCategories
        .filter(
          (candidate) =>
            Number.isSafeInteger(candidate.id) &&
            candidate.id >= 100_000 &&
            candidate.name
              .split(/[|/]/)
              .map(normalizeCategoryName)
              .some((segment) => categoryMatchers[category].test(segment))
        )
        .map((candidate) => candidate.id)
    ),
  ].sort((left, right) => left - right);
