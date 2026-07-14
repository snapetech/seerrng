import { MediaType } from '@server/constants/media';
import type {
  DiscoverHomeStateItem,
  DiscoverHomeStateResponse,
} from '@server/interfaces/api/discoverHomeInterfaces';

interface CatalogItem {
  id: number | string;
  mediaType: string;
  mediaInfo?: object;
}

interface CatalogPage {
  results: CatalogItem[];
}

const getStateMediaType = (mediaType: string): MediaType | undefined => {
  switch (mediaType) {
    case 'movie':
      return MediaType.MOVIE;
    case 'tv':
      return MediaType.TV;
    case 'album':
      return MediaType.MUSIC;
    case 'book':
      return MediaType.BOOK;
    default:
      return undefined;
  }
};

export const getDiscoverStateInputs = (pages: CatalogPage[]) => {
  const inputs = new Map<
    string,
    { mediaType: MediaType; id: number | string }
  >();

  for (const page of pages) {
    for (const item of page.results) {
      const mediaType = getStateMediaType(item.mediaType);

      if (!mediaType) {
        continue;
      }

      const key = `${mediaType}:${item.id}`;
      inputs.set(key, { mediaType, id: item.id });

      if (inputs.size === 100) {
        return [...inputs.values()];
      }
    }
  }

  return [...inputs.values()];
};

const applyState = (
  item: CatalogItem,
  state: DiscoverHomeStateItem
): CatalogItem => {
  if (!state.media && !item.mediaInfo) {
    return item;
  }

  const mediaInfo: Record<string, unknown> = { ...(item.mediaInfo ?? {}) };

  if (state.media) {
    mediaInfo.id = state.media.id;
    mediaInfo.status = state.media.status;
    mediaInfo.status4k = state.media.status4k;
    mediaInfo.updatedAt = state.media.updatedAt;
  }

  mediaInfo.watchlists = state.watchlisted
    ? ((mediaInfo.watchlists as unknown[])?.length ?? 0) > 0
      ? mediaInfo.watchlists
      : [{ id: -1 }]
    : [];
  mediaInfo.requests = state.request ? [state.request] : [];

  return { ...item, mediaInfo };
};

export const applyDiscoverStateOverlay = <T extends CatalogPage>(
  pages: T[],
  response: DiscoverHomeStateResponse
): T[] => {
  const stateByKey = new Map(response.items.map((item) => [item.key, item]));

  return pages.map(
    (page) =>
      ({
        ...page,
        results: page.results.map((item) => {
          const mediaType = getStateMediaType(item.mediaType);
          const state = mediaType
            ? stateByKey.get(`${mediaType}:${item.id}`)
            : undefined;

          return state ? applyState(item, state) : item;
        }),
      }) as T
  );
};
