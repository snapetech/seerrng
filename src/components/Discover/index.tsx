import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import { sliderTitles } from '@app/components/Discover/constants';
import MediaSlider from '@app/components/MediaSlider';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  ArrowDownOnSquareIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  PencilIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';
import { DiscoverSliderType } from '@server/constants/discover';
import type DiscoverSlider from '@server/entity/DiscoverSlider';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const CreateSlider = dynamic(
  () => import('@app/components/Discover/CreateSlider')
);
const DiscoverSliderEdit = dynamic(
  () => import('@app/components/Discover/DiscoverSliderEdit')
);
const MovieGenreSlider = dynamic(
  () => import('@app/components/Discover/MovieGenreSlider')
);
const NetworkSlider = dynamic(
  () => import('@app/components/Discover/NetworkSlider')
);
const PlexWatchlistSlider = dynamic(
  () => import('@app/components/Discover/PlexWatchlistSlider')
);
const RecentRequestsSlider = dynamic(
  () => import('@app/components/Discover/RecentRequestsSlider')
);
const RecentlyAddedSlider = dynamic(
  () => import('@app/components/Discover/RecentlyAddedSlider')
);
const StudioSlider = dynamic(
  () => import('@app/components/Discover/StudioSlider')
);
const TvGenreSlider = dynamic(
  () => import('@app/components/Discover/TvGenreSlider')
);

const messages = defineMessages('components.Discover', {
  discover: 'Discover',
  emptywatchlist: 'Items added to your watchlist will appear here.',
  resettodefault: 'Reset to Default',
  resetwarning:
    'Reset all sliders to default. This will also delete any custom sliders!',
  updatesuccess: 'Updated discover customization settings.',
  updatefailed:
    'Something went wrong updating the discover customization settings.',
  resetsuccess: 'Sucessfully reset discover customization settings.',
  resetfailed:
    'Something went wrong resetting the discover customization settings.',
  customizediscover: 'Customize Discover',
  stopediting: 'Stop Editing',
  createnewslider: 'Create New Slider',
});

type DiscoverProps = {
  initialSliders?: DiscoverSlider[];
};

const Discover = ({ initialSliders }: DiscoverProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const {
    data: discoverData,
    error: discoverError,
    mutate,
  } = useSWR<DiscoverSlider[]>('/api/v1/settings/discover', {
    fallbackData: initialSliders,
    revalidateOnMount: !initialSliders,
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });
  const [sliders, setSliders] = useState<Partial<DiscoverSlider>[]>(
    initialSliders ?? []
  );
  const [isEditing, setIsEditing] = useState(false);

  // We need to sync the state here so that we can modify the changes locally without commiting
  // anything to the server until the user decides to save the changes
  useEffect(() => {
    if (discoverData && !isEditing) {
      setSliders(discoverData);
    }
  }, [discoverData, isEditing]);

  const hasChanged = () => !Object.is(discoverData, sliders);

  const getEncodedSliderData = (slider: Partial<DiscoverSlider>) =>
    encodeURIExtraParams(slider.data ?? '');

  const getSliderDataPart = (slider: Partial<DiscoverSlider>, index: number) =>
    encodeURIExtraParams(slider.data?.split(',')[index] ?? '');

  const updateSliders = async () => {
    try {
      await axios.post('/api/v1/settings/discover', sliders);

      addToast(intl.formatMessage(messages.updatesuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setIsEditing(false);
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.updatefailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const resetSliders = async () => {
    try {
      await axios.post('/api/v1/settings/discover/reset');

      addToast(intl.formatMessage(messages.resetsuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setIsEditing(false);
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.resetfailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const upcomingDate = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  if (!discoverData && !discoverError) {
    return <LoadingSpinner />;
  }

  return (
    <div className="discover-home">
      <PageTitle title={intl.formatMessage(messages.discover)} />
      {hasPermission(Permission.ADMIN) && (
        <>
          {isEditing && (
            <div className="my-6 rounded-lg bg-gray-800">
              <div className="flex items-center space-x-2 rounded-t-lg border-t border-r border-l border-gray-800 bg-gray-900 p-4 text-lg font-semibold text-gray-400">
                <PlusIcon className="w-6" />
                <span data-testid="create-slider-header">
                  {intl.formatMessage(messages.createnewslider)}
                </span>
              </div>
              <div className="p-4">
                <CreateSlider
                  onCreate={async (createdSlider) => {
                    const newSliders = [createdSlider, ...sliders];
                    await mutate(newSliders as DiscoverSlider[], false);
                    setSliders(newSliders);
                  }}
                />
              </div>
            </div>
          )}
          <Transition
            as="div"
            show={!isEditing}
            enter="transition-opacity duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            className="absolute-bottom-shift fixed right-6 z-50 flex items-center sm:bottom-8"
          >
            <Button
              buttonType="default"
              buttonSize="sm"
              onClick={() => setIsEditing(true)}
              data-testid="discover-start-editing"
              aria-label={intl.formatMessage(messages.customizediscover)}
              className="shadow"
            >
              <PencilIcon className="!mr-0 h-4 w-4" />
            </Button>
          </Transition>
          <Transition
            as="div"
            show={isEditing}
            enter="transition duration-300"
            enterFrom="opacity-0 translate-y-6"
            enterTo="opacity-100 translate-y-0"
            leave="transition duration-300"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-6"
            className="safe-shift-edit-menu fixed right-0 left-0 z-50 flex flex-col items-center justify-end space-y-2 space-x-0 border-t border-gray-700 bg-gray-800/80 p-4 backdrop-blur sm:bottom-0 sm:flex-row sm:space-y-0 sm:space-x-3"
          >
            <Button
              buttonType="default"
              onClick={() => setIsEditing(false)}
              className="w-full sm:w-auto"
            >
              <ArrowUturnLeftIcon />
              <span>{intl.formatMessage(messages.stopediting)}</span>
            </Button>
            <Tooltip content={intl.formatMessage(messages.resetwarning)}>
              <ConfirmButton
                onClick={() => resetSliders()}
                confirmText={intl.formatMessage(globalMessages.areyousure)}
                className="w-full sm:w-auto"
              >
                <ArrowPathIcon />
                <span>{intl.formatMessage(messages.resettodefault)}</span>
              </ConfirmButton>
            </Tooltip>
            <Button
              buttonType="primary"
              type="submit"
              disabled={!hasChanged()}
              onClick={() => updateSliders()}
              data-testid="discover-customize-submit"
              className="w-full sm:w-auto"
            >
              <ArrowDownOnSquareIcon />
              <span>{intl.formatMessage(globalMessages.save)}</span>
            </Button>
          </Transition>
        </>
      )}
      {(isEditing ? sliders : discoverData)?.map((slider, index) => {
        let sliderComponent: React.ReactNode;

        switch (slider.type) {
          case DiscoverSliderType.RECENTLY_ADDED:
            sliderComponent = <RecentlyAddedSlider />;
            break;
          case DiscoverSliderType.RECENT_REQUESTS:
            sliderComponent = <RecentRequestsSlider />;
            break;
          case DiscoverSliderType.PLEX_WATCHLIST:
            sliderComponent = <PlexWatchlistSlider />;
            break;
          case DiscoverSliderType.TRENDING:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="trending"
                title={intl.formatMessage(sliderTitles.trending)}
                url="/api/v1/discover/trending"
                linkUrl="/discover/trending"
                prioritizeFirstRow
              />
            );
            break;
          case DiscoverSliderType.POPULAR_MOVIES:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="popular-movies"
                title={intl.formatMessage(sliderTitles.popularmovies)}
                url="/api/v1/discover/movies"
                linkUrl="/discover/movies"
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.MOVIE_GENRES:
            sliderComponent = <MovieGenreSlider />;
            break;
          case DiscoverSliderType.UPCOMING_MOVIES:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="upcoming"
                title={intl.formatMessage(sliderTitles.upcoming)}
                linkUrl={`/discover/movies?primaryReleaseDateGte=${upcomingDate}`}
                url="/api/v1/discover/movies"
                extraParams={`primaryReleaseDateGte=${upcomingDate}`}
              />
            );
            break;
          case DiscoverSliderType.STUDIOS:
            sliderComponent = <StudioSlider />;
            break;
          case DiscoverSliderType.POPULAR_TV:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="popular-tv"
                title={intl.formatMessage(sliderTitles.populartv)}
                url="/api/v1/discover/tv"
                linkUrl="/discover/tv"
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.POPULAR_MUSIC:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="popular-music"
                title={intl.formatMessage(sliderTitles.popularmusic)}
                url="/api/v1/discover/music"
                linkUrl="/discover/music"
                extraParams="sortBy=ranked"
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.POPULAR_BOOKS:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="popular-books"
                title={intl.formatMessage(sliderTitles.popularbooks)}
                url="/api/v1/discover/books"
                linkUrl="/discover/books"
                extraParams="sortBy=ranked"
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.TV_GENRES:
            sliderComponent = <TvGenreSlider />;
            break;
          case DiscoverSliderType.UPCOMING_TV:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey="upcoming-tv"
                title={intl.formatMessage(sliderTitles.upcomingtv)}
                linkUrl={`/discover/tv?firstAirDateGte=${upcomingDate}`}
                url="/api/v1/discover/tv"
                extraParams={`firstAirDateGte=${upcomingDate}`}
              />
            );
            break;
          case DiscoverSliderType.NETWORKS:
            sliderComponent = <NetworkSlider />;
            break;
          case DiscoverSliderType.TMDB_MOVIE_KEYWORD:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/movies"
                extraParams={`keywords=${getEncodedSliderData(slider)}`}
                linkUrl={`/discover/movies?keywords=${getEncodedSliderData(
                  slider
                )}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_KEYWORD:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/tv"
                extraParams={`keywords=${getEncodedSliderData(slider)}`}
                linkUrl={`/discover/tv?keywords=${getEncodedSliderData(
                  slider
                )}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_GENRE:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/movies`}
                extraParams={`genre=${getEncodedSliderData(slider)}`}
                linkUrl={`/discover/movies?genre=${getEncodedSliderData(
                  slider
                )}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_GENRE:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/tv`}
                extraParams={`genre=${getEncodedSliderData(slider)}`}
                linkUrl={`/discover/tv?genre=${getEncodedSliderData(slider)}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_STUDIO:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/movies/studio/${getEncodedSliderData(
                  slider
                )}`}
                linkUrl={`/discover/movies/studio/${getEncodedSliderData(
                  slider
                )}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_NETWORK:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/tv/network/${getEncodedSliderData(
                  slider
                )}`}
                linkUrl={`/discover/tv/network/${getEncodedSliderData(slider)}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_SEARCH:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/search"
                extraParams={`query=${getEncodedSliderData(slider)}`}
                linkUrl={`/search?query=${getEncodedSliderData(slider)}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_STREAMING_SERVICES:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/movies"
                extraParams={`watchRegion=${getSliderDataPart(
                  slider,
                  0
                )}&watchProviders=${getSliderDataPart(slider, 1)}`}
                linkUrl={`/discover/movies?watchRegion=${getSliderDataPart(
                  slider,
                  0
                )}&watchProviders=${getSliderDataPart(slider, 1)}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_STREAMING_SERVICES:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/tv"
                extraParams={`watchRegion=${getSliderDataPart(
                  slider,
                  0
                )}&watchProviders=${getSliderDataPart(slider, 1)}`}
                linkUrl={`/discover/tv?watchRegion=${getSliderDataPart(
                  slider,
                  0
                )}&watchProviders=${getSliderDataPart(slider, 1)}`}
              />
            );
            break;
          case DiscoverSliderType.OPENLIBRARY_BOOK_SUBJECT:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/books"
                extraParams={`subject=${encodeURIExtraParams(
                  slider.data ?? ''
                )}&sortBy=ranked`}
                linkUrl={`/discover/books?subject=${encodeURIExtraParams(
                  slider.data ?? ''
                )}&sortBy=ranked`}
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.MUSICBRAINZ_MUSIC_GENRE:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/music"
                extraParams={`genre=${encodeURIExtraParams(
                  slider.data ?? ''
                )}&sortBy=ranked`}
                linkUrl={`/discover/music?genre=${encodeURIExtraParams(
                  slider.data ?? ''
                )}&sortBy=ranked`}
                randomizeOrder
              />
            );
            break;
          case DiscoverSliderType.LISTENBRAINZ_MUSIC_CHART:
            sliderComponent = (
              <MediaSlider
                hideWhenEmpty
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/music"
                extraParams={`sortBy=${encodeURIExtraParams(
                  slider.data ?? ''
                )}`}
                linkUrl={`/discover/music?sortBy=${encodeURIExtraParams(
                  slider.data ?? ''
                )}`}
              />
            );
            break;
        }

        if (isEditing) {
          return (
            <DiscoverSliderEdit
              key={`discover-slider-${slider.id}-edit`}
              slider={slider}
              onDelete={async () => {
                const newSliders = sliders.filter(
                  (currentSlider) => currentSlider.id !== slider.id
                );
                await mutate(newSliders as DiscoverSlider[], false);
                setSliders(newSliders);
              }}
              onEnable={() => {
                const tempSliders = sliders.slice();
                tempSliders[index].enabled = !tempSliders[index].enabled;
                setSliders(tempSliders);
              }}
              onPositionUpdate={(updatedItemId, position, hasClickedArrows) => {
                const originalPosition = sliders.findIndex(
                  (item) => item.id === updatedItemId
                );
                const originalItem = sliders[originalPosition];

                const tempSliders = sliders.slice();

                tempSliders.splice(originalPosition, 1);
                if (hasClickedArrows) {
                  tempSliders.splice(
                    position === 'Above' ? index - 1 : index + 1,
                    0,
                    originalItem
                  );
                } else {
                  tempSliders.splice(
                    position === 'Above' && index > originalPosition
                      ? Math.max(index - 1, 0)
                      : index,
                    0,
                    originalItem
                  );
                }

                setSliders(tempSliders);
              }}
              disableUpButton={index === 0}
              disableDownButton={index === sliders.length - 1}
            >
              {sliderComponent}
            </DiscoverSliderEdit>
          );
        }

        if (!slider.enabled) {
          return null;
        }

        return (
          <div key={`discover-slider-${slider.id}`}>{sliderComponent}</div>
        );
      })}
    </div>
  );
};

export default Discover;
