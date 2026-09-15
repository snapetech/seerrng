import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import MediaTypeBadge, {
  getMediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import { getIssueMediaAndFormatLabel } from '@app/components/IssueDetails/issueMediaFormat';
import { issueOptions } from '@app/components/IssueModal/constants';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { EyeIcon } from '@heroicons/react/24/outline';
import { IssueStatus } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR from 'swr';
import { getIssueAffectedSummary } from './issueAffectedSummary';

const messages = defineMessages('components.IssueList.IssueItem', {
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  firstPublished: 'First Published',
  runtime: 'Runtime',
  pages: 'Pages',
  director: 'Director',
  creator: 'Creator',
  studio: 'Studio',
  network: 'Network',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  author: 'Author',
  publisher: 'Publisher',
  affected: 'Affected',
  description: 'Description',
  createdBy: 'Created By',
  createdDate: 'Created Date',
  issuetype: 'Type',
  issuestatus: 'Status',
  viewissue: 'View Issue',
  medianotfound: 'Media Not Found',
  unknownissuetype: 'Unknown',
  unavailable: 'Not available',
});

type IssueTitle = MovieDetails | TvDetails | MusicDetails | BookDetails;
type LinkedDetailValue = {
  name: string;
  href?: string;
};
type LinkedDetail = {
  label: string;
  values: LinkedDetailValue[];
};

const isMovie = (movie: IssueTitle): movie is MovieDetails => {
  return (
    !isMusic(movie) &&
    !isBook(movie) &&
    (movie as MovieDetails).title !== undefined
  );
};

const isMusic = (title: IssueTitle): title is MusicDetails => {
  return (title as MusicDetails).mediaType === 'album';
};

const isBook = (title: IssueTitle): title is BookDetails => {
  return (title as BookDetails).mediaType === 'book';
};

const getTitle = (title: IssueTitle): string =>
  isMovie(title) || isMusic(title) || isBook(title) ? title.title : title.name;

const getReleaseDate = (title: IssueTitle): string | undefined =>
  isMovie(title)
    ? title.releaseDate
    : isMusic(title)
      ? title.releaseDate
      : isBook(title)
        ? title.firstPublishYear?.toString()
        : title.firstAirDate;

const getRuntime = (title: IssueTitle, unavailable: string): string => {
  if (isBook(title)) {
    return title.numberOfPages?.toLocaleString() ?? unavailable;
  }
  const minutes = isMovie(title)
    ? title.runtime
    : isMusic(title)
      ? Math.round(
          title.tracks.reduce((total, track) => total + track.length, 0) / 60000
        )
      : title.episodeRunTime[0];
  return minutes ? `${minutes.toLocaleString()} minutes` : unavailable;
};

const getSecondaryDetails = (
  title: IssueTitle,
  issue: Issue,
  intl: ReturnType<typeof useIntl>
): LinkedDetail[] => {
  const unavailable = intl.formatMessage(messages.unavailable);
  if (isMovie(title)) {
    const director = title.credits.crew.find(
      (credit) => credit.job === 'Director'
    );
    const studio = title.productionCompanies[0];
    return [
      {
        label: intl.formatMessage(messages.director),
        values: [
          {
            name: director?.name ?? unavailable,
            href: director?.id ? `/person/${director.id}` : undefined,
          },
        ],
      },
      {
        label: intl.formatMessage(messages.studio),
        values: [
          {
            name: studio?.name ?? unavailable,
            href: studio?.id
              ? `/discover/movies/studio/${studio.id}`
              : undefined,
          },
        ],
      },
    ];
  }
  if (isMusic(title)) {
    return [
      {
        label: intl.formatMessage(messages.artist),
        values: [
          {
            name: title.artist.name,
            href: title.artist.id
              ? `/artist/${encodeApiPathSegment(title.artist.id)}`
              : undefined,
          },
        ],
      },
      {
        label: intl.formatMessage(messages.albumType),
        values: [{ name: title.type }],
      },
      {
        label: intl.formatMessage(messages.trackCount),
        values: [{ name: title.tracks.length.toLocaleString() }],
      },
    ];
  }
  if (isBook(title)) {
    return [
      {
        label: intl.formatMessage(messages.author),
        values: [
          {
            name: title.author ?? unavailable,
            href: title.authorId
              ? `/author/${encodeApiPathSegment(title.authorId)}`
              : undefined,
          },
        ],
      },
      {
        label: intl.formatMessage(messages.publisher),
        values: [{ name: title.publisher ?? unavailable }],
      },
    ];
  }

  const affected = getIssueAffectedSummary(
    issue,
    title.seasons.map((season) => season.seasonNumber)
  );
  return [
    {
      label: intl.formatMessage(messages.creator),
      values:
        title.createdBy.length > 0
          ? title.createdBy.map((creator) => ({
              name: creator.name,
              href: `/person/${creator.id}`,
            }))
          : [{ name: unavailable }],
    },
    {
      label: intl.formatMessage(messages.network),
      values:
        title.networks.length > 0
          ? title.networks.map((network) => ({
              name: network.name,
              href: `/discover/tv/network/${network.id}`,
            }))
          : [{ name: unavailable }],
    },
    {
      label: intl.formatMessage(messages.affected),
      values: [{ name: affected }],
    },
  ];
};

const getBackdrop = (
  title: IssueTitle
): { src: string; type: 'tmdb' | 'music' | 'book' } | undefined => {
  if (isMusic(title)) {
    const src = title.artistBackdrop ?? title.artistThumb ?? title.posterPath;
    return src ? { src, type: 'music' } : undefined;
  }
  if (isBook(title)) {
    return title.posterPath
      ? { src: title.posterPath, type: 'book' }
      : undefined;
  }
  if (title.backdropPath) {
    return {
      src: `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${title.backdropPath}`,
      type: 'tmdb',
    };
  }
  return title.posterPath
    ? { src: getTmdbPosterImageUrl(title.posterPath), type: 'tmdb' }
    : undefined;
};

interface IssueItemProps {
  issue: Issue;
}

const IssueItem = ({ issue }: IssueItemProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const bookId = issue.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;
  const normalizedMusicId = issue.media.mbId
    ? normalizeMusicBrainzId(issue.media.mbId)
    : undefined;
  const normalizedBookId = bookId
    ? normalizeOpenLibraryWorkId(bookId)
    : undefined;
  const url =
    issue.media.mediaType === MediaType.MOVIE
      ? `/api/v1/movie/${issue.media.tmdbId}`
      : issue.media.mediaType === MediaType.TV
        ? `/api/v1/tv/${issue.media.tmdbId}`
        : issue.media.mediaType === MediaType.MUSIC && normalizedMusicId
          ? `/api/v1/music/${encodeApiPathSegment(normalizedMusicId)}`
          : issue.media.mediaType === MediaType.BOOK && normalizedBookId
            ? `/api/v1/book/${encodeApiPathSegment(normalizedBookId)}`
            : null;
  const mediaHref =
    issue.media.mediaType === MediaType.MOVIE
      ? `/movie/${issue.media.tmdbId}`
      : issue.media.mediaType === MediaType.TV
        ? `/tv/${issue.media.tmdbId}`
        : issue.media.mediaType === MediaType.MUSIC && normalizedMusicId
          ? `/music/${encodeApiPathSegment(normalizedMusicId)}`
          : normalizedBookId
            ? `/book/${encodeApiPathSegment(normalizedBookId)}`
            : '/';
  const { data: title, error } = useSWR<IssueTitle>(inView ? url : null);

  if (!url && inView) {
    return (
      <div
        className="refreshed-card-surface flex h-64 w-full flex-col justify-center rounded-xl py-4 shadow-md ring-1 ring-red-500 xl:h-28 xl:flex-row"
        ref={ref}
      >
        <div className="flex w-full flex-col justify-center overflow-hidden px-4">
          <div className="text-lg font-bold text-white xl:text-xl">
            {intl.formatMessage(messages.medianotfound)}
          </div>
        </div>
      </div>
    );
  }

  if (!title && !error) {
    return (
      <div
        className="h-64 w-full animate-pulse rounded-xl bg-gray-800 xl:h-28"
        ref={ref}
      />
    );
  }

  if (!title) {
    return (
      <div
        className="refreshed-card-surface flex h-64 w-full flex-col justify-center rounded-xl py-4 shadow-md ring-1 ring-red-500 xl:h-28 xl:flex-row"
        ref={ref}
      >
        <div className="flex w-full flex-col justify-center overflow-hidden px-4">
          <div className="text-lg font-bold text-white xl:text-xl">
            {intl.formatMessage(messages.medianotfound)}
          </div>
        </div>
      </div>
    );
  }

  const issueOption = issueOptions.find(
    (opt) => opt.issueType === issue?.issueType
  );

  const description = issue.comments?.[0]?.message || '';
  const unavailable = intl.formatMessage(messages.unavailable);
  const releaseDate = getReleaseDate(title);
  const releaseYear = releaseDate?.match(/\d{4}/)?.[0];
  const displayTitle = `${getTitle(title)}${releaseYear ? ` (${releaseYear})` : ''}`;
  const posterSrc = title.posterPath
    ? isMusic(title) || isBook(title)
      ? title.posterPath
      : getTmdbPosterImageUrl(title.posterPath)
    : '/images/seerr_poster_not_found.png';
  const posterType = isBook(title) ? 'book' : isMusic(title) ? 'music' : 'tmdb';
  const backdrop = getBackdrop(title);
  const secondaryDetails = getSecondaryDetails(title, issue, intl);
  const canViewCreator = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );
  const mediaLabel = getIssueMediaAndFormatLabel(
    issue.media.mediaType,
    issue.is4k
  );
  const statusClass =
    issue.status === IssueStatus.OPEN
      ? 'compact-detail-status-badge-danger'
      : 'compact-detail-status-badge-success';

  return (
    <article className="refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
      {backdrop && (
        <div className="absolute inset-0 z-0">
          <CachedImage
            type={backdrop.type}
            src={backdrop.src}
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="refreshed-artwork-scrim" />
          <div className="refreshed-artwork-gradient" />
        </div>
      )}
      <div className="relative z-10 grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
        <Link
          href={mediaHref}
          className="relative block h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 transition hover:ring-indigo-400 sm:h-[120px] sm:w-20"
        >
          <CachedImage
            type={posterType}
            src={posterSrc}
            alt=""
            fill
            sizes="(min-width: 640px) 80px, 64px"
            className="object-cover"
          />
          <span className="pointer-events-none absolute top-1 left-1/2 z-10 w-[calc(100%-0.375rem)] -translate-x-1/2">
            <MediaTypeBadge
              mediaType={
                getMediaTypeBadgeType(issue.media.mediaType) ?? 'movie'
              }
              variant="compact"
              className="h-[18px] w-full justify-center gap-0.5 px-1 py-0 text-[9px] shadow-sm [&_svg]:h-2.5 [&_svg]:w-2.5"
            />
          </span>
        </Link>

        <div className="flex min-w-0 flex-col">
          <Link
            href={mediaHref}
            className="-mt-0.5 block truncate text-lg leading-5 font-semibold text-white hover:underline"
          >
            {displayTitle}
          </Link>
          <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1">
            <div className="card:col-span-2 card:pr-3 min-w-0">
              <dl className="refreshed-detail-text card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                  {intl.formatMessage(messages.mediaAndFormat)}:
                </dt>
                <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                  {mediaLabel}
                </dd>
                <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                  {intl.formatMessage(
                    isBook(title)
                      ? messages.firstPublished
                      : messages.releaseDate
                  )}
                  :
                </dt>
                <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                  {releaseDate || unavailable}
                </dd>
                <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                  {intl.formatMessage(
                    isBook(title) ? messages.pages : messages.runtime
                  )}
                  :
                </dt>
                <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                  {getRuntime(title, unavailable)}
                </dd>
                <div className="media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                  {secondaryDetails.map((detail) => (
                    <div className="contents" key={detail.label}>
                      <dt className="font-medium text-gray-100">
                        {detail.label}:
                      </dt>
                      <dd className="m-0 truncate">
                        {detail.values.map((value, index) => (
                          <span key={`${detail.label}-${value.name}-${index}`}>
                            {index > 0 && ', '}
                            {value.href ? (
                              <Link
                                href={value.href}
                                className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                              >
                                {value.name}
                              </Link>
                            ) : (
                              value.name
                            )}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </div>
                <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                  {intl.formatMessage(messages.description)}:
                </dt>
                <dd className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 mt-0.5 line-clamp-2 min-w-0 break-words">
                  {description || unavailable}
                </dd>
              </dl>
            </div>

            <dl className="refreshed-detail-text media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.createdBy)}:
              </dt>
              <dd className="m-0 truncate">
                {canViewCreator ? (
                  <Link
                    href={`/users/${issue.createdBy.id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline"
                  >
                    {issue.createdBy.displayName}
                  </Link>
                ) : (
                  unavailable
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.createdDate)}:
              </dt>
              <dd className="m-0 truncate">
                <FormattedDate
                  value={new Date(issue.createdAt)}
                  dateStyle="medium"
                />
              </dd>
              <dt aria-hidden="true" />
              <dd className="m-0 truncate">
                <FormattedDate
                  value={new Date(issue.createdAt)}
                  timeStyle="short"
                />
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issuetype)}:
              </dt>
              <dd className="m-0 truncate">
                {intl.formatMessage(
                  issueOption?.name ?? messages.unknownissuetype
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issuestatus)}:
              </dt>
              <dd className="m-0 truncate">
                <Badge
                  href={`/issues/${issue.id}`}
                  badgeType="dark"
                  className={`compact-detail-status-badge ${statusClass}`}
                >
                  {intl.formatMessage(
                    issue.status === IssueStatus.OPEN
                      ? globalMessages.open
                      : globalMessages.resolved
                  )}
                </Badge>
              </dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-[5px] flex justify-end">
        <Link
          href={`/issues/${issue.id}`}
          className="compact-control inline-flex items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] leading-none font-semibold text-emerald-200 transition hover:border-emerald-500 hover:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
        >
          <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{intl.formatMessage(messages.viewissue)}</span>
        </Link>
      </div>
    </article>
  );
};

export default IssueItem;
