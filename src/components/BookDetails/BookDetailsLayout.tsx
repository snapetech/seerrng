import CachedImage from '@app/components/Common/CachedImage';
import PlayOnDeviceButton from '@app/components/Common/PlayOnDeviceButton';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import PlaybackTrackList from '@app/components/MediaDetails/PlaybackTrackList';
import useDetailDisclosurePins from '@app/hooks/useDetailDisclosurePins';
import usePlaybackCatalog from '@app/hooks/usePlaybackCatalog';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import { normalizeBookOverviewMarkdown } from '@app/utils/bookMarkdown';
import defineMessages from '@app/utils/defineMessages';
import { resolveCanonicalPlaybackSelection } from '@app/utils/playbackSelection';
import { getSafeMarkdownHref } from '@app/utils/safeUrl';
import type { BookDetails } from '@server/models/Book';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import ReactMarkdown from 'react-markdown';

const messages = defineMessages('components.BookDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  firstPublished: 'First Published',
  pages: 'Pages',
  publisher: 'Publisher',
  author: 'Author',
  editions: 'Editions',
  isbn: 'ISBN',
  ebook: 'Book',
  audiobook: 'Audiobook',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  genres: 'Genres',
  noGenres: 'No Genres Available',
  bookDetails: 'Book Details',
  openLibrary: 'Open Library',
  edition: 'Edition',
  isbnCandidates: 'ISBN Candidates',
  available: 'Available',
  requested: 'Requested',
  notRequested: 'Not Requested',
  notAvailable: 'Not available',
});

export interface BookFormatCoverage {
  format: 'ebook' | 'audiobook';
  available: boolean;
  requested: boolean;
}

interface BookDetailsLayoutProps {
  data: BookDetails;
  formatCoverage: BookFormatCoverage[];
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
  playbackActions?: (itemIds: string[]) => ReactNode;
  additionalContent?: ReactNode;
}

const genreTones = [
  'border-indigo-400/80 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/35',
  'border-purple-400/80 bg-purple-500/20 text-purple-100 hover:bg-purple-500/35',
  'border-emerald-400/80 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35',
  'border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35',
  'border-sky-400/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/35',
  'border-rose-400/80 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35',
] as const;

const BookDetailsLayout = ({
  data,
  formatCoverage,
  primaryActions,
  secondaryActions,
  playbackActions,
  additionalContent,
}: BookDetailsLayoutProps) => {
  const intl = useIntl();
  const { pins, togglePinned } = useDetailDisclosurePins('book');
  const [showGenres, setShowGenres] = useState(false);
  const [selectedPlaybackItemIds, setSelectedPlaybackItemIds] = useState<
    string[]
  >([]);
  const { data: playbackCatalog } = usePlaybackCatalog(data.mediaInfo?.id);
  useEffect(() => {
    setShowGenres(pins.subjectTags);
  }, [pins.subjectTags]);
  useEffect(() => {
    const allowedIds = new Set(
      playbackCatalog?.groups.flatMap((group) =>
        group.items.map((item) => item.id)
      ) ?? []
    );
    setSelectedPlaybackItemIds((current) =>
      current.filter((itemId) => allowedIds.has(itemId))
    );
  }, [playbackCatalog]);
  const availablePlaybackItemIds =
    playbackCatalog?.groups.flatMap((group) =>
      group.items.map((item) => item.id)
    ) ?? [];
  const effectivePlaybackItemIds = resolveCanonicalPlaybackSelection(
    availablePlaybackItemIds,
    selectedPlaybackItemIds
  );
  const unavailable = intl.formatMessage(messages.notAvailable);
  const workId = encodeApiPathSegment(data.id);
  const authorId = data.authorId
    ? encodeApiPathSegment(data.authorId)
    : undefined;
  const availableFormats = formatCoverage
    .filter((format) => format.available)
    .map((format) =>
      intl.formatMessage(
        format.format === 'ebook' ? messages.ebook : messages.audiobook
      )
    );
  const mediaAndFormat = `Book${
    availableFormats.length > 0 ? ` · ${availableFormats.join(' + ')}` : ''
  }`;
  const genres = [
    ...new Set((data.subjects ?? []).map((genre) => genre.trim())),
  ]
    .filter(Boolean)
    .slice(0, 50);
  const formatStatus = (coverage: BookFormatCoverage) =>
    intl.formatMessage(
      coverage.available
        ? messages.available
        : coverage.requested
          ? messages.requested
          : messages.notRequested
    );

  return (
    <div className="media-page">
      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {data.posterPath && (
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <CachedImage
              type="book"
              src={data.posterPath}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-center"
            />
            <div className="refreshed-artwork-scrim" />
            <div className="refreshed-artwork-gradient" />
          </div>
        )}

        <div className="relative z-10">
          <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
            <div
              className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20"
              data-testid="media-details-poster"
            >
              <CachedImage
                type="book"
                src={data.posterPath || '/images/seerr_poster_not_found.png'}
                alt=""
                fill
                priority
                sizes="(min-width: 640px) 80px, 64px"
                className="object-cover"
              />
            </div>

            <div className="flex min-w-0 flex-col">
              <h1
                className="text-lg leading-5 font-semibold text-white"
                data-testid="media-title"
              >
                {data.title}
                {data.firstPublishYear ? ` (${data.firstPublishYear})` : ''}
              </h1>

              <div className="card:grid-cols-3 mt-4 grid min-w-0 flex-1 grid-cols-1">
                <div className="card:col-span-2 card:pr-3 min-w-0">
                  <dl className="card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                    <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                      {intl.formatMessage(messages.mediaAndFormat)}:
                    </dt>
                    <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                      {mediaAndFormat}
                    </dd>
                    <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                      {intl.formatMessage(messages.firstPublished)}:
                    </dt>
                    <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                      {data.firstPublishYear ?? unavailable}
                    </dd>
                    <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                      {intl.formatMessage(messages.pages)}:
                    </dt>
                    <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                      {data.numberOfPages
                        ? intl.formatNumber(data.numberOfPages)
                        : unavailable}
                    </dd>
                    <div className="media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(messages.author)}:
                      </dt>
                      <dd className="m-0 truncate">
                        {data.author ? (
                          authorId ? (
                            <Link
                              href={`/author/${authorId}`}
                              className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                            >
                              {data.author}
                            </Link>
                          ) : (
                            data.author
                          )
                        ) : (
                          unavailable
                        )}
                      </dd>
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(messages.editions)}:
                      </dt>
                      <dd className="m-0 truncate">
                        {data.editionCount
                          ? intl.formatNumber(data.editionCount)
                          : unavailable}
                      </dd>
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(messages.isbn)}:
                      </dt>
                      <dd className="m-0 truncate">
                        {data.isbn13 || unavailable}
                      </dd>
                    </div>

                    <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                      {intl.formatMessage(messages.genres)}:
                    </dt>
                    <dd
                      className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 mt-0.5 min-w-0 break-words"
                      data-testid="media-details-genres"
                    >
                      {genres.length > 0
                        ? genres.slice(0, 4).map((genre, index) => (
                            <span key={genre}>
                              {index > 0 && ', '}
                              <Link
                                href={`/discover/books?subject=${encodeURIComponent(genre)}&sortBy=ranked`}
                                className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                              >
                                {genre}
                              </Link>
                            </span>
                          ))
                        : unavailable}
                    </dd>
                  </dl>
                </div>

                <dl className="media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                  {formatCoverage.map((coverage) => (
                    <div className="contents" key={coverage.format}>
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(
                          coverage.format === 'ebook'
                            ? messages.ebook
                            : messages.audiobook
                        )}
                        :
                      </dt>
                      <dd className="m-0 truncate">
                        <AvailabilityValue
                          tone={
                            coverage.available
                              ? 'available'
                              : coverage.requested
                                ? 'processing'
                                : 'unavailable'
                          }
                        >
                          {formatStatus(coverage)}
                        </AvailabilityValue>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>

          {playbackCatalog && availablePlaybackItemIds.length > 0 && (
            <PlaybackTrackList
              catalog={playbackCatalog}
              selectedItemIds={selectedPlaybackItemIds}
              onSelectionChange={setSelectedPlaybackItemIds}
            />
          )}
          {playbackActions && (
            <div className="media-rating-row">
              {playbackActions(effectivePlaybackItemIds)}
              <PlayOnDeviceButton
                mediaId={data.mediaInfo?.id}
                itemIds={effectivePlaybackItemIds}
              />
            </div>
          )}

          <div className="media-primary-action-row">
            {primaryActions}
            {secondaryActions}
          </div>

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="media-inset-heading">
              {intl.formatMessage(messages.overview)}
            </h2>
            <div className="refreshed-detail-text-muted prose prose-sm prose-p:my-0 prose-p:leading-5 prose-a:text-indigo-300 prose-a:underline prose-a:hover:text-indigo-200 mt-4 max-w-none text-sm leading-5">
              <ReactMarkdown
                skipHtml
                urlTransform={getSafeMarkdownHref}
                components={{
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {normalizeBookOverviewMarkdown(
                  data.description ||
                    intl.formatMessage(messages.overviewUnavailable)
                )}
              </ReactMarkdown>
            </div>
          </section>

          <div className="mt-[5px] flex flex-wrap items-center gap-2">
            <DetailDisclosureButton
              label={intl.formatMessage(messages.genres)}
              open={showGenres}
              onClick={() => setShowGenres((open) => !open)}
              pinned={pins.subjectTags}
              onPinClick={() => void togglePinned('subjectTags')}
            />
          </div>

          {showGenres && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading mb-2">
                {intl.formatMessage(messages.genres)}
              </h2>
              {genres.length === 0 ? (
                <p className="refreshed-detail-text-muted text-xs">
                  {intl.formatMessage(messages.noGenres)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((genre, index) => (
                    <Link
                      key={genre}
                      href={`/discover/books?subject=${encodeURIComponent(genre)}&sortBy=ranked`}
                      className={`compact-control inline-flex items-center rounded-full border px-2 text-[11px] font-medium transition focus:ring-2 focus:ring-indigo-400 focus:outline-none ${
                        genreTones[index % genreTones.length]
                      }`}
                    >
                      {genre}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="media-inset-heading mb-3">
              {intl.formatMessage(messages.bookDetails)}
            </h2>
            <div className="card:grid-cols-3 grid grid-cols-1">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.firstPublished)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.firstPublishYear ?? unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.pages)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.numberOfPages
                    ? intl.formatNumber(data.numberOfPages)
                    : unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.editions)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.editionCount
                    ? intl.formatNumber(data.editionCount)
                    : unavailable}
                </dd>
              </dl>

              <dl className="media-detail-column-divider card:pr-3 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.publisher)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.publisher || unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.author)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.author ? (
                    authorId ? (
                      <Link
                        href={`/author/${authorId}`}
                        className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                      >
                        {data.author}
                      </Link>
                    ) : (
                      data.author
                    )
                  ) : (
                    unavailable
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.edition)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.editionId || unavailable}
                </dd>
              </dl>

              <dl className="media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.openLibrary)}:
                </dt>
                <dd className="m-0 truncate">
                  <a
                    href={`https://openlibrary.org/works/${workId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {data.id}
                  </a>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.isbnCandidates)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {data.isbnCandidates?.length
                    ? data.isbnCandidates.slice(0, 4).map((candidate) => (
                        <span
                          className="block truncate"
                          key={`${candidate.editionId ?? candidate.isbn}-${candidate.isbn}`}
                          title={[
                            candidate.isbn,
                            candidate.title,
                            candidate.format,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {candidate.isbn}
                        </span>
                      ))
                    : unavailable}
                </dd>
              </dl>
            </div>
          </section>
          {additionalContent}
        </div>
      </article>
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default BookDetailsLayout;
