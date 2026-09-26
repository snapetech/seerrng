export interface OptionalServiceAvailability {
  musicEnabled: boolean;
  booksEnabled: boolean;
  comicsEnabled: boolean;
  magazinesEnabled?: boolean;
  softwareEnabled?: boolean;
}

export const isOptionalCatalogPathEnabled = (
  path: string,
  availability: OptionalServiceAvailability
): boolean => {
  if (path === '/discover/music') {
    return availability.musicEnabled;
  }

  if (path === '/discover/comics') {
    return availability.comicsEnabled;
  }

  if (path === '/discover/magazines') {
    return Boolean(availability.magazinesEnabled);
  }

  if (path === '/software') {
    return Boolean(availability.softwareEnabled);
  }

  return (
    !['/discover/books', '/discover/audiobooks'].includes(path) ||
    availability.booksEnabled
  );
};
