import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import MediaTypeBadge, {
  getMediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import { getIssueMediaAndFormatLabel } from '@app/components/IssueDetails/issueMediaFormat';
import {
  getIssueSubtypeOptionsForMediaType,
  issueOptions,
} from '@app/components/IssueModal/constants';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  encodeApiPathSegment,
  normalizeExternalTitleId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { getSafeHref } from '@app/utils/safeUrl';
import { EyeIcon, ServerIcon } from '@heroicons/react/24/outline';
import { IssueStatus } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { BookDetails } from '@server/models/Book';
import type { ComicDetails } from '@server/models/Comic';
import type { MagazineDetails } from '@server/models/Magazine';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const IssueDiscussion = dynamic(
  () => import('@app/components/IssueDetails/IssueDiscussion')
);

const messages = defineMessages('components.IssueList.IssueItem', {
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  firstPublished: 'First Published',
  runtime: 'Runtime',
  pages: 'Pages',
  issues: 'Issues',
  description: 'Description',
  createdBy: 'Created By',
  createdDate: 'Created Date',
  issuetype: 'Type',
  issuereason: 'Reason',
  issueAction: 'Status',
  viewDetails: 'View Details',
  detailsHelp:
    'Expand or collapse this issue’s description, comments and actions here.',
  loading: 'Loading issue details…',
  loadFailed: 'Unable to load issue details.',
  retry: 'Retry',
  open: 'Open',
  closed: 'Closed',
  medianotfound: 'Media Not Found',
  unknownissuetype: 'Unknown',
  unavailable: 'Not available',
  latestIssue: 'Latest Issue',
  openarr: 'Open in {arr}',
  openarrFormat: 'Open {format} in {arr}',
  ebook: 'Book',
  audiobook: 'Audiobook',
});

type IssueTitle =
  | MovieDetails
  | TvDetails
  | MusicDetails
  | BookDetails
  | ComicDetails
  | MagazineDetails;

const isMovie = (movie: IssueTitle): movie is MovieDetails => {
  return (
    !isMusic(movie) &&
    !isBook(movie) &&
    !isComic(movie) &&
    !isMagazine(movie) &&
    (movie as MovieDetails).title !== undefined
  );
};

const isMusic = (title: IssueTitle): title is MusicDetails => {
  return (title as MusicDetails).mediaType === 'album';
};

const isBook = (title: IssueTitle): title is BookDetails => {
  return (title as BookDetails).mediaType === 'book';
};

const isComic = (title: IssueTitle): title is ComicDetails => {
  return (title as ComicDetails).mediaType === 'comic';
};

const isMagazine = (title: IssueTitle): title is MagazineDetails => {
  return (title as MagazineDetails).mediaType === 'magazine';
};

const getTitle = (title: IssueTitle): string =>
  isMovie(title) ||
  isMusic(title) ||
  isBook(title) ||
  isComic(title) ||
  isMagazine(title)
    ? title.title
    : title.name;

const getReleaseDate = (title: IssueTitle): string | undefined =>
  isMovie(title)
    ? title.releaseDate
    : isMusic(title)
      ? title.releaseDate
      : isBook(title)
        ? title.firstPublishYear?.toString()
        : isComic(title)
          ? title.startYear
          : isMagazine(title)
            ? title.latestIssue
            : title.firstAirDate;

const getRuntime = (title: IssueTitle, unavailable: string): string => {
  if (isBook(title)) {
    return title.numberOfPages?.toLocaleString() ?? unavailable;
  }
  if (isComic(title)) {
    return title.issueCount?.toLocaleString() ?? unavailable;
  }
  if (isMagazine(title)) {
    return title.issueCount?.toLocaleString() ?? unavailable;
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

const getBackdrop = (
  title: IssueTitle
): { src: string; type: 'tmdb' | 'music' | 'book' } | undefined => {
  if (isMusic(title)) {
    const src = title.artistBackdrop ?? title.artistThumb ?? title.posterPath;
    return src ? { src, type: 'music' } : undefined;
  }
  if (isBook(title) || isComic(title) || isMagazine(title)) {
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
  embedded?: boolean;
  initiallyExpanded?: boolean;
  onUpdate?: () => void;
}

const IssueItem = ({
  issue: summaryIssue,
  embedded = false,
  initiallyExpanded = false,
  onUpdate,
}: IssueItemProps) => {
  const intl = useIntl();
  const [detailsExpanded, setDetailsExpanded] = useState(initiallyExpanded);
  const detailsId = useId();
  const {
    data: fullIssue,
    error: issueError,
    mutate: refreshIssue,
  } = useSWR<Issue>(
    detailsExpanded ? `/api/v1/issue/${summaryIssue.id}` : null
  );
  const issue = fullIssue ?? summaryIssue;
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const bookId = issue.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;
  const comicId = issue.media.identifiers?.find(
    (identifier) => identifier.provider === 'comicvine'
  )?.value;
  const magazineId = issue.media.identifiers?.find(
    (identifier) => identifier.provider === 'lazylibrarian'
  )?.value;
  const normalizedMusicId = issue.media.mbId
    ? normalizeMusicBrainzId(issue.media.mbId)
    : undefined;
  const normalizedBookId = bookId
    ? normalizeOpenLibraryWorkId(bookId)
    : undefined;
  const normalizedMagazineId = magazineId
    ? normalizeExternalTitleId('magazine', magazineId).toString()
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
            : issue.media.mediaType === MediaType.COMIC && comicId
              ? `/api/v1/comic/${encodeApiPathSegment(comicId)}`
              : issue.media.mediaType === MediaType.MAGAZINE &&
                  normalizedMagazineId
                ? `/api/v1/magazine/${encodeApiPathSegment(normalizedMagazineId)}`
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
            : comicId
              ? `/comic/${encodeApiPathSegment(comicId)}`
              : normalizedMagazineId
                ? `/magazine/${encodeApiPathSegment(normalizedMagazineId)}`
                : '/';
  const { data: title, error } = useSWR<IssueTitle>(inView ? url : null);
  const refreshDiscussion = async () => {
    await refreshIssue();
    await mutate(
      (key) =>
        typeof key === 'string' &&
        (key === url ||
          key.startsWith('/api/v1/issue?') ||
          key === '/api/v1/issue/count')
    );
    onUpdate?.();
  };

  if (!url && inView) {
    return (
      <div
        className="app-card-main refreshed-card-surface flex h-64 w-full flex-col justify-center rounded-xl py-4 shadow-md ring-1 ring-red-500 xl:h-28 xl:flex-row"
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
        className="app-card-main refreshed-card-surface flex h-64 w-full flex-col justify-center rounded-xl py-4 shadow-md ring-1 ring-red-500 xl:h-28 xl:flex-row"
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
  const issueSubtypeOption =
    issue && issue.media.mediaType !== 'sports'
      ? getIssueSubtypeOptionsForMediaType(issue.media.mediaType).find(
          (option) => option.value === issue.issueSubtype
        )
      : undefined;

  const description = issue.comments?.[0]?.message || '';
  const unavailable = intl.formatMessage(messages.unavailable);
  const releaseDate = getReleaseDate(title);
  const releaseYear = releaseDate?.match(/\d{4}/)?.[0];
  const displayTitle = `${getTitle(title)}${releaseYear ? ` (${releaseYear})` : ''}`;
  const posterSrc = title.posterPath
    ? isMusic(title) || isBook(title) || isComic(title) || isMagazine(title)
      ? title.posterPath
      : getTmdbPosterImageUrl(title.posterPath)
    : '/images/seerr_poster_not_found.png';
  const posterType =
    isBook(title) || isComic(title) || isMagazine(title)
      ? 'book'
      : isMusic(title)
        ? 'music'
        : 'tmdb';
  const backdrop = getBackdrop(title);
  const canViewCreator = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );
  const mediaLabel = getIssueMediaAndFormatLabel(
    issue.media.mediaType,
    issue.is4k
  );
  const issueServiceLinks = [
    issue.media.serviceUrl
      ? {
          key: 'primary',
          url: getSafeHref(issue.media.serviceUrl),
          label:
            issue.media.mediaType === MediaType.BOOK
              ? intl.formatMessage(messages.openarrFormat, {
                  arr: 'Bookshelf',
                  format: intl.formatMessage(messages.ebook),
                })
              : undefined,
        }
      : undefined,
    issue.media.mediaType === MediaType.BOOK && issue.media.audiobookServiceUrl
      ? {
          key: 'audiobook',
          url: getSafeHref(issue.media.audiobookServiceUrl),
          label: intl.formatMessage(messages.openarrFormat, {
            arr: 'Bookshelf',
            format: intl.formatMessage(messages.audiobook),
          }),
        }
      : undefined,
  ].filter((link): link is { key: string; url: string; label: string } =>
    Boolean(link?.url && link.label)
  );
  return (
    <article
      className={
        embedded
          ? 'app-card-inset refreshed-inset-surface issue-summary-card'
          : 'app-card-main refreshed-card-surface issue-summary-card issue-summary-card-standalone'
      }
    >
      {!embedded && backdrop && (
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
          className="detail-card-poster relative block overflow-hidden rounded-lg ring-1 ring-gray-600 transition hover:ring-indigo-400"
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
            className="detail-summary-title block truncate text-lg leading-5 font-semibold text-white hover:underline"
          >
            {displayTitle}
          </Link>
          <div className="detail-card-heading-spacing detail-three-column-grid grid min-h-0 min-w-0 flex-1">
            <div className="detail-paired-column-span min-w-0">
              <dl className="media-detail-rows refreshed-detail-text detail-paired-columns grid min-w-0 content-start text-xs">
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
                      : isComic(title)
                        ? messages.firstPublished
                        : isMagazine(title)
                          ? messages.latestIssue
                          : messages.releaseDate
                  )}
                  :
                </dt>
                <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                  {releaseDate || unavailable}
                </dd>
                <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                  {intl.formatMessage(
                    isBook(title)
                      ? messages.pages
                      : isComic(title)
                        ? messages.issues
                        : messages.runtime
                  )}
                  :
                </dt>
                <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                  {getRuntime(title, unavailable)}
                </dd>
                <div className="media-detail-rows media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
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
                </div>
                <dt className="card:col-start-1 card:row-start-4 font-medium text-gray-100">
                  {intl.formatMessage(messages.description)}:
                </dt>
                <dd className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 line-clamp-2 min-w-0 break-words">
                  {description || unavailable}
                </dd>
              </dl>
            </div>

            <dl className="media-detail-rows refreshed-detail-text media-detail-column-divider issue-summary-status-column grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-xs">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issuetype)}:
              </dt>
              <dd className="m-0 truncate">
                {intl.formatMessage(
                  issueOption?.name ?? messages.unknownissuetype
                )}
              </dd>
              {issueSubtypeOption && (
                <>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.issuereason)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {intl.formatMessage(issueSubtypeOption.name)}
                  </dd>
                </>
              )}
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issueAction)}:
              </dt>
              <dd className="issue-action-value">
                <Badge
                  shape="standard"
                  badgeType={
                    issue.status === IssueStatus.OPEN ? 'danger' : 'success'
                  }
                  className={`compact-detail-status-badge ${issue.status === IssueStatus.OPEN ? 'compact-detail-status-badge-danger' : 'compact-detail-status-badge-success'}`}
                >
                  {intl.formatMessage(
                    issue.status === IssueStatus.OPEN
                      ? messages.open
                      : messages.closed
                  )}
                </Badge>
              </dd>
              <dt className="sr-only">
                {intl.formatMessage(messages.viewDetails)}
              </dt>
              <dd className="issue-action-value issue-summary-details-action">
                <Button
                  type="button"
                  buttonType="success"
                  buttonSize="sm"
                  title={intl.formatMessage(messages.detailsHelp)}
                  aria-expanded={detailsExpanded}
                  aria-controls={detailsId}
                  onClick={() => setDetailsExpanded((value) => !value)}
                >
                  <EyeIcon aria-hidden="true" />
                  {intl.formatMessage(messages.viewDetails)}
                </Button>
              </dd>
            </dl>
          </div>
        </div>
      </div>
      {detailsExpanded && (
        <section
          id={detailsId}
          className="issue-discussion-content card-spacing-before"
          aria-label={intl.formatMessage(messages.viewDetails)}
        >
          {hasPermission(Permission.ADMIN) && issueServiceLinks.length > 0 && (
            <div className="card-spacing-after flex flex-wrap gap-2">
              {issueServiceLinks.map((link) => (
                <a
                  key={`issue-service-link-${link.key}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button buttonType="success" buttonSize="sm">
                    <ServerIcon aria-hidden="true" />
                    {link.label}
                  </Button>
                </a>
              ))}
            </div>
          )}
          {issueError ? (
            <div role="alert" className="card-stack">
              <p>{intl.formatMessage(messages.loadFailed)}</p>
              <Button
                buttonType="success"
                title={intl.formatMessage(messages.loadFailed)}
                onClick={() => void refreshIssue()}
              >
                {intl.formatMessage(messages.retry)}
              </Button>
            </div>
          ) : fullIssue ? (
            <IssueDiscussion issue={fullIssue} onUpdate={refreshDiscussion} />
          ) : (
            <p role="status">{intl.formatMessage(messages.loading)}</p>
          )}
        </section>
      )}
    </article>
  );
};

export default IssueItem;
