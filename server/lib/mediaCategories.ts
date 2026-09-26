import type { MediaCategoryKey } from '@server/constants/mediaCategories';
import { getSettings } from '@server/lib/settings';

/** Existing settings files without category flags keep every category enabled. */
export const isMediaCategoryEnabled = (category: MediaCategoryKey): boolean =>
  getSettings().main.enabledMediaCategories?.[category] !== false;

export const areMediaCategoriesEnabled = (
  categories: readonly MediaCategoryKey[],
  mode: 'all' | 'any' = 'all'
): boolean =>
  mode === 'all'
    ? categories.every(isMediaCategoryEnabled)
    : categories.some(isMediaCategoryEnabled);
