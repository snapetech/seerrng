const RELEASE_MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const formatCoverArtArchiveThumbnailUrl = (
  releaseMbid: string,
  imageId: number | string
): string => {
  const encodedReleaseMbid = encodeURIComponent(releaseMbid);
  const encodedImageId = encodeURIComponent(String(imageId));

  return `https://archive.org/download/mbid-${encodedReleaseMbid}/mbid-${encodedReleaseMbid}-${encodedImageId}_thumb250.jpg`;
};

export const getCoverArtArchiveThumbnailUrl = (
  releaseMbid: unknown,
  imageId: unknown
): string | undefined =>
  typeof releaseMbid === 'string' &&
  RELEASE_MBID_PATTERN.test(releaseMbid) &&
  typeof imageId === 'number' &&
  Number.isSafeInteger(imageId) &&
  imageId > 0
    ? formatCoverArtArchiveThumbnailUrl(releaseMbid, imageId)
    : undefined;
