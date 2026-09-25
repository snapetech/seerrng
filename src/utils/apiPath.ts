export const encodeApiPathSegment = (value: number | string): string =>
  encodeURIComponent(value.toString());

export const normalizeMusicBrainzId = (id: number | string): string =>
  id.toString().trim().toLocaleLowerCase();

export const normalizeOpenLibraryWorkId = (id: number | string): string =>
  id
    .toString()
    .trim()
    .replace(/^\/?works\//i, '')
    .replace(/^ol(\d+)w$/i, 'OL$1W');

export const normalizeExternalTitleId = (
  mediaType: 'album' | 'music' | 'book' | string,
  id: number | string
): number | string => {
  if (mediaType === 'album' || mediaType === 'music') {
    return normalizeMusicBrainzId(id);
  }

  if (mediaType === 'book') {
    return normalizeOpenLibraryWorkId(id);
  }

  if (mediaType === 'magazine') {
    return id
      .toString()
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  return id;
};
