import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Tooltip from '@app/components/Common/Tooltip';
import ShowMoreCard from '@app/components/MediaSlider/ShowMoreCard';
import PersonCard from '@app/components/PersonCard';
import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import useCardTextVisibility from '@app/hooks/useCardTextVisibility';
import useDiscoverHomeManifest from '@app/hooks/useDiscoverHomeManifest';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import useWarmImageCache, {
  DISCOVER_SHELF_POSTER_CACHE_WARM_LIMIT,
} from '@app/hooks/useWarmImageCache';
import {
  buildDiscoverCacheContextKey,
  buildDiscoverSnapshotKey,
  createDiscoverSnapshot,
  isDiscoverSnapshotFresh,
  setDiscoverSnapshot,
  useDiscoverSnapshot,
} from '@app/utils/discoverSnapshot';
import {
  applyDiscoverStateOverlay,
  getDiscoverOverlayRequestKey,
  getDiscoverStateInputs,
} from '@app/utils/discoverStateOverlay';
import {
  MEDIA_SLIDER_TITLE_LIMIT,
  hasMediaSliderResults,
  shouldShowMoreSliderCard,
} from '@app/utils/mediaSlider';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { DiscoverHomeStateResponse } from '@server/interfaces/api/discoverHomeInterfaces';
import type {
  AlbumResult,
  ArtistResult,
  BookResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { appendDiscoverQueryString } from '@server/utils/discoverQuery';
import axios from 'axios';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWRInfinite from 'swr/infinite';

interface MixedResult {
  page: number;
  totalResults: number;
  totalPages: number;
  results: (
    | TvResult
    | MovieResult
    | PersonResult
    | AlbumResult
    | ArtistResult
    | BookResult
  )[];
}

interface MediaSliderProps {
  title: string;
  url: string;
  linkUrl?: string;
  sliderKey: string;
  hideWhenEmpty?: boolean;
  extraParams?: string;
  onNewTitles?: (titleCount: number) => void;
  randomizeOrder?: boolean;
  prioritizeFirstRow?: boolean;
}

type SliderTitle =
  | TvResult
  | MovieResult
  | PersonResult
  | AlbumResult
  | ArtistResult
  | BookResult;

const getMediaResultKey = (item: SliderTitle): string =>
  `${item.mediaType}:${item.id}`;

const MediaSlider = ({
  title,
  url,
  linkUrl,
  extraParams,
  sliderKey,
  hideWhenEmpty = false,
  onNewTitles,
  randomizeOrder = false,
  prioritizeFirstRow = false,
}: MediaSliderProps) => {
  const settings = useSettings();
  const { visibility } = useCardTextVisibility();
  const { user } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const [initialShuffleSeed] = useState(() =>
    Math.random().toString(36).slice(2)
  );
  const cacheContextKey = useMemo(
    () =>
      user
        ? buildDiscoverCacheContextKey({
            userId: user.id,
            permissions: user.permissions,
            discoverRegion:
              user.settings?.discoverRegion ??
              settings.currentSettings.discoverRegion,
            streamingRegion:
              user.settings?.streamingRegion ??
              settings.currentSettings.streamingRegion,
            originalLanguage:
              user.settings?.originalLanguage ??
              settings.currentSettings.originalLanguage,
          })
        : undefined,
    [
      settings.currentSettings.discoverRegion,
      settings.currentSettings.originalLanguage,
      settings.currentSettings.streamingRegion,
      user,
    ]
  );
  const snapshotKey = useMemo(
    () =>
      cacheContextKey
        ? buildDiscoverSnapshotKey(cacheContextKey, sliderKey, url, extraParams)
        : undefined,
    [cacheContextKey, extraParams, sliderKey, url]
  );
  const { hydrated: snapshotHydrated, snapshot } = useDiscoverSnapshot<
    MixedResult[]
  >(snapshotKey, cacheContextKey);
  const { manifest } = useDiscoverHomeManifest(cacheContextKey);
  const appliedUserStateRequest = useRef<string | undefined>(undefined);
  const [seedOverride, setSeedOverride] = useState<{
    snapshotKey?: string;
    seed: string;
  }>();
  const shuffleSeed =
    (seedOverride?.snapshotKey === snapshotKey
      ? seedOverride?.seed
      : snapshot?.metadata.seed) ?? initialShuffleSeed;
  const fallbackData = snapshot?.data;
  const fallbackHasResults = hasMediaSliderResults(fallbackData);
  const shouldLoad =
    !!user && snapshotHydrated && (!!fallbackData || isEditingSafe() || inView);
  const getKey = useCallback(
    (pageIndex: number, previousPageData: MixedResult | null) => {
      if (!shouldLoad) {
        return null;
      }

      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }

      return [
        `${url}?${appendDiscoverQueryString(
          {
            page: pageIndex + 1,
            shuffleSeed: randomizeOrder ? shuffleSeed : undefined,
          },
          extraParams
        )}`,
        cacheContextKey,
      ] as const;
    },
    [cacheContextKey, extraParams, randomizeOrder, shouldLoad, shuffleSeed, url]
  );

  const {
    data,
    error,
    setSize,
    size,
    mutate: revalidate,
  } = useSWRInfinite<MixedResult>(getKey, {
    initialSize: 1,
    revalidateFirstPage: !fallbackHasResults,
    revalidateOnMount: !fallbackData || !fallbackHasResults,
    dedupingInterval: 30000,
    fetcher: ([requestUrl]: [string, string]) =>
      axios.get<MixedResult>(requestUrl).then((response) => response.data),
    revalidateOnFocus: false,
    fallbackData,
  });

  useEffect(() => {
    const layoutChanged =
      !!manifest &&
      snapshot?.metadata.layoutRevision !== manifest.layoutRevision;

    if (
      shouldLoad &&
      snapshot &&
      (!isDiscoverSnapshotFresh(snapshot) || layoutChanged)
    ) {
      void revalidate();
    }
  }, [manifest, revalidate, shouldLoad, snapshot]);

  useEffect(() => {
    if (
      !data?.length ||
      !manifest ||
      !cacheContextKey ||
      !snapshotKey ||
      snapshot?.metadata.userStateRevision === manifest.userStateRevision
    ) {
      return;
    }

    const inputs = getDiscoverStateInputs(data);
    const overlayRequestKey = getDiscoverOverlayRequestKey(
      cacheContextKey,
      manifest.userStateRevision,
      inputs
    );

    if (appliedUserStateRequest.current === overlayRequestKey) {
      return;
    }

    if (!inputs.length) {
      appliedUserStateRequest.current = overlayRequestKey;
      return;
    }

    const controller = new AbortController();
    let active = true;
    appliedUserStateRequest.current = overlayRequestKey;
    void axios
      .post<DiscoverHomeStateResponse>(
        '/api/v1/discover/home/state',
        { items: inputs },
        { signal: controller.signal }
      )
      .then(async (response) => {
        if (!active) {
          return;
        }
        const updatedData = applyDiscoverStateOverlay(data, response.data);
        await revalidate(updatedData, false);
        if (!active) {
          return;
        }
        await setDiscoverSnapshot(
          snapshotKey,
          createDiscoverSnapshot(cacheContextKey, updatedData, {
            freshAgeMs: manifest.freshness.rowMaxAgeSeconds * 1000,
            seed: randomizeOrder ? shuffleSeed : undefined,
            manifestVersion: manifest.version,
            layoutRevision: manifest.layoutRevision,
            userStateRevision: manifest.userStateRevision,
          })
        );
      })
      .catch(() => {
        if (active && appliedUserStateRequest.current === overlayRequestKey) {
          appliedUserStateRequest.current = undefined;
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    cacheContextKey,
    data,
    manifest,
    randomizeOrder,
    revalidate,
    shuffleSeed,
    snapshot?.metadata.userStateRevision,
    snapshotKey,
  ]);

  const refreshRandomizedOrder = useCallback(() => {
    if (!randomizeOrder) {
      return;
    }

    setSize(1);
    setSeedOverride({
      snapshotKey,
      seed: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    });
  }, [randomizeOrder, setSize, snapshotKey]);

  const titles = useMemo(() => {
    const filteredTitles: SliderTitle[] = [];
    const resultKeys = new Set<string>();

    for (const page of data ?? []) {
      for (const item of page.results) {
        const resultKey = getMediaResultKey(item);

        if (resultKeys.has(resultKey)) {
          continue;
        }

        resultKeys.add(resultKey);

        if (
          settings.currentSettings.hideAvailable &&
          'mediaInfo' in item &&
          item.mediaInfo &&
          (item.mediaInfo.status === MediaStatus.AVAILABLE ||
            item.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE)
        ) {
          continue;
        }

        if (
          'mediaInfo' in item &&
          item.mediaInfo?.status === MediaStatus.BLOCKLISTED
        ) {
          continue;
        }

        filteredTitles.push(item);
      }
    }

    return filteredTitles;
  }, [data, settings.currentSettings.hideAvailable]);
  const renderableTitles = titles;
  const visibleTitles = useMemo(
    () => renderableTitles.slice(0, MEDIA_SLIDER_TITLE_LIMIT),
    [renderableTitles]
  );

  useWarmImageCache(renderableTitles, {
    maxUrls: DISCOVER_SHELF_POSTER_CACHE_WARM_LIMIT,
    posterOnly: true,
  });

  const shouldLoadMore =
    renderableTitles.length < MEDIA_SLIDER_TITLE_LIMIT + 4 &&
    size < 5 &&
    (data?.[0]?.totalResults ?? 0) > size * MEDIA_SLIDER_TITLE_LIMIT;

  useEffect(() => {
    if (shouldLoadMore) {
      setSize((currentSize) => currentSize + 1);
    }
  }, [setSize, shouldLoadMore]);

  useEffect(() => {
    if (
      cacheContextKey &&
      snapshotKey &&
      data?.length &&
      data !== fallbackData &&
      (!hideWhenEmpty || hasMediaSliderResults(data))
    ) {
      void setDiscoverSnapshot(
        snapshotKey,
        createDiscoverSnapshot(cacheContextKey, data, {
          freshAgeMs: (manifest?.freshness.rowMaxAgeSeconds ?? 300) * 1000,
          seed: randomizeOrder ? shuffleSeed : undefined,
          manifestVersion: manifest?.version,
          layoutRevision: manifest?.layoutRevision,
          userStateRevision: manifest?.userStateRevision,
        })
      );
    }
  }, [
    cacheContextKey,
    data,
    fallbackData,
    hideWhenEmpty,
    manifest,
    randomizeOrder,
    shuffleSeed,
    snapshotKey,
  ]);

  useEffect(() => {
    if (onNewTitles) {
      // We aren't reporting all titles. We just want to know if there are any titles
      // at all for our purposes.
      onNewTitles(renderableTitles.length);
    }
  }, [onNewTitles, renderableTitles.length]);

  const showMorePosters = useMemo(
    () =>
      renderableTitles
        .slice(MEDIA_SLIDER_TITLE_LIMIT, MEDIA_SLIDER_TITLE_LIMIT + 4)
        .map((title) =>
          title.mediaType !== 'person' && title.mediaType !== 'artist'
            ? title.posterPath
            : undefined
        ),
    [renderableTitles]
  );

  const finalTitles = useMemo(() => {
    const cardTitles = visibleTitles.map((title, index) => {
      switch (title.mediaType) {
        case 'movie':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              status4k={title.mediaInfo?.status4k}
              summary={title.overview}
              title={title.title}
              userScore={title.voteAverage}
              year={title.releaseDate}
              mediaType={title.mediaType}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              inProgress4k={
                (title.mediaInfo?.downloadStatus4k ?? []).length > 0
              }
              showText={visibility.movie === 'always'}
              priority={prioritizeFirstRow && index < 3}
            />
          );
        case 'tv':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              status4k={title.mediaInfo?.status4k}
              summary={title.overview}
              title={title.name}
              userScore={title.voteAverage}
              year={title.firstAirDate}
              mediaType={title.mediaType}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              inProgress4k={
                (title.mediaInfo?.downloadStatus4k ?? []).length > 0
              }
              showText={visibility.tv === 'always'}
              priority={prioritizeFirstRow && index < 3}
            />
          );
        case 'person':
          return (
            <PersonCard
              key={title.id}
              personId={title.id}
              name={title.name}
              profilePath={title.profilePath}
            />
          );
        case 'album':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              title={title.title}
              artist={title['artist-credit']?.[0]?.name}
              type={title['primary-type']}
              year={
                title.releaseDate ?? title['first-release-date']?.split('-')[0]
              }
              mediaType={title.mediaType}
              availableQualities={title.availableQualities}
              qualityStatuses={title.qualityStatuses}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              needsCoverArt={title.needsCoverArt}
              showText={visibility.album === 'always'}
              priority={prioritizeFirstRow && index < 3}
            />
          );
        case 'book':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              image={title.posterPath}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              status={title.mediaInfo?.status}
              title={title.title}
              artist={title.author}
              year={title.firstPublishYear?.toString()}
              mediaType={title.mediaType}
              showText={visibility.book === 'always'}
              priority={prioritizeFirstRow && index < 3}
            />
          );
        case 'artist':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              image={title.artistThumb ?? undefined}
              title={title.name}
              mediaType={title.mediaType}
              priority={prioritizeFirstRow && index < 3}
            />
          );
      }
    });

    const shouldShowMore = shouldShowMoreSliderCard({
      hasLink: !!linkUrl,
      loadedTitleCount: renderableTitles.length,
      totalResults: data?.[0]?.totalResults ?? 0,
    });

    if (linkUrl && shouldShowMore) {
      cardTitles.push(
        <ShowMoreCard key="show-more" url={linkUrl} posters={showMorePosters} />
      );
    }

    return cardTitles;
  }, [
    data,
    linkUrl,
    prioritizeFirstRow,
    renderableTitles.length,
    showMorePosters,
    visibleTitles,
    visibility.album,
    visibility.book,
    visibility.movie,
    visibility.tv,
  ]);

  const hasReachedEnd =
    !!data &&
    ((data[data.length - 1]?.results.length ?? 0) < MEDIA_SLIDER_TITLE_LIMIT ||
      (data[data.length - 1]?.totalResults ?? 0) <=
        size * MEDIA_SLIDER_TITLE_LIMIT ||
      size >= 5);

  if (hideWhenEmpty && data && hasReachedEnd && !renderableTitles.length) {
    return null;
  }

  const visibleMediaTypes = (['movie', 'tv', 'album', 'book'] as const).filter(
    (mediaType) => visibleTitles.some((item) => item.mediaType === mediaType)
  );

  return (
    <div ref={ref}>
      <div className="slider-header">
        {linkUrl ? (
          <Link href={linkUrl} className="slider-title min-w-0">
            <span className="truncate">{title}</span>
          </Link>
        ) : (
          <div className="slider-title">
            <span>{title}</span>
          </div>
        )}
        {visibleMediaTypes.length > 0 && (
          <CardTextVisibilityToggle mediaType={visibleMediaTypes} />
        )}
        {randomizeOrder && (
          <Tooltip content={`Refresh ${title}`}>
            <Button
              type="button"
              buttonType="trailer"
              buttonSize="sm"
              onClick={refreshRandomizedOrder}
              className="h-8 w-8 p-0"
              aria-label={`Refresh ${title}`}
            >
              <ArrowPathIcon className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
      </div>
      <Slider
        sliderKey={sliderKey}
        isLoading={snapshotHydrated && shouldLoad && !data && !error}
        isEmpty={!!data && hasReachedEnd && !renderableTitles.length}
        items={finalTitles}
      />
    </div>
  );
};

const isEditingSafe = () => typeof window === 'undefined';

export default MediaSlider;
