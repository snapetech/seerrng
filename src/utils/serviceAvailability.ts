export interface OptionalServiceAvailability {
  musicEnabled: boolean;
  booksEnabled: boolean;
}

export const isOptionalCatalogPathEnabled = (
  path: string,
  availability: OptionalServiceAvailability
): boolean =>
  path !== '/discover/music'
    ? !['/discover/books', '/discover/audiobooks'].includes(path) ||
      availability.booksEnabled
    : availability.musicEnabled;
