import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import IssueComment from '@app/components/IssueDetails/IssueComment';
import IssueDescription from '@app/components/IssueDetails/IssueDescription';
import { issueOptions } from '@app/components/IssueModal/constants';
import useDeepLinks from '@app/hooks/useDeepLinks';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  getTmdbPosterImageUrl,
  getTmdbPosterImageVariants,
} from '@app/utils/imageCache';
import { getSafeHref } from '@app/utils/safeUrl';
import { Transition } from '@headlessui/react';
import {
  ChatBubbleOvalLeftEllipsisIcon,
  CheckCircleIcon,
  PlayIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/24/solid';
import { IssueStatus, MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type Issue from '@server/entity/Issue';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueDetails', {
  openedby: '#{issueId} opened {relativeTime} by {username}',
  closeissue: 'Close Issue',
  closeissueandcomment: 'Close with Comment',
  leavecomment: 'Comment',
  comments: 'Comments',
  reopenissue: 'Reopen Issue',
  reopenissueandcomment: 'Reopen with Comment',
  issuepagetitle: 'Issue',
  playonplex: 'Play on {mediaServerName}',
  play4konplex: 'Play in 4K on {mediaServerName}',
  openinarr: 'Open in {arr}',
  openinarrFormat: 'Open {format} in {arr}',
  openin4karr: 'Open in 4K {arr}',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  toasteditdescriptionsuccess: 'Issue description edited successfully!',
  toasteditdescriptionfailed:
    'Something went wrong while editing the issue description.',
  toaststatusupdated: 'Issue status updated successfully!',
  toaststatusupdatefailed:
    'Something went wrong while updating the issue status.',
  issuetype: 'Type',
  lastupdated: 'Last Updated',
  problemseason: 'Affected Season',
  allseasons: 'All Seasons',
  season: 'Season {seasonNumber}',
  problemepisode: 'Affected Episode',
  allepisodes: 'All Episodes',
  episode: 'Episode {episodeNumber}',
  deleteissue: 'Delete Issue',
  deleteissueconfirm: 'Are you sure you want to delete this issue?',
  toastissuedeleted: 'Issue deleted successfully!',
  toastissuedeletefailed: 'Something went wrong while deleting the issue.',
  nocomments: 'No comments.',
  unknownissuetype: 'Unknown',
  commentplaceholder: 'Add a comment…',
  validationCommentLength:
    'Comment must be {maxLength, number} characters or fewer',
});

type IssueMediaDetails = MovieDetails | TvDetails | MusicDetails | BookDetails;
type IssueServiceLink = {
  key: string;
  url: string;
  formatLabel?: string;
};

const isMusic = (media: IssueMediaDetails): media is MusicDetails => {
  return (media as MusicDetails).mediaType === 'album';
};

const isBook = (media: IssueMediaDetails): media is BookDetails => {
  return (media as BookDetails).mediaType === 'book';
};

const isMovie = (media: IssueMediaDetails): media is MovieDetails => {
  return (
    !isMusic(media) &&
    !isBook(media) &&
    (media as MovieDetails).title !== undefined
  );
};

const IssueDetails = () => {
  const { addToast } = useToasts();
  const router = useRouter();
  const intl = useIntl();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { user: currentUser, hasPermission } = useUser();
  const issueId =
    typeof router.query.issueId === 'string' ? router.query.issueId : '';
  const { data: issueData, mutate: revalidateIssue } = useSWR<Issue>(
    issueId ? `/api/v1/issue/${issueId}` : null
  );
  const bookId = issueData?.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;
  const normalizedMusicId = issueData?.media.mbId
    ? normalizeMusicBrainzId(issueData.media.mbId)
    : undefined;
  const normalizedBookId = bookId
    ? normalizeOpenLibraryWorkId(bookId)
    : undefined;
  const detailUrl =
    issueData?.media.mediaType === MediaType.MOVIE
      ? `/api/v1/movie/${issueData.media.tmdbId}`
      : issueData?.media.mediaType === MediaType.TV
        ? `/api/v1/tv/${issueData.media.tmdbId}`
        : issueData?.media.mediaType === MediaType.MUSIC && normalizedMusicId
          ? `/api/v1/music/${encodeApiPathSegment(normalizedMusicId)}`
          : issueData?.media.mediaType === MediaType.BOOK && normalizedBookId
            ? `/api/v1/book/${encodeApiPathSegment(normalizedBookId)}`
            : null;
  const { data, error } = useSWR<IssueMediaDetails>(detailUrl);

  const { mediaUrl, mediaUrl4k } = useDeepLinks({
    mediaUrl: data?.mediaInfo?.mediaUrl,
    mediaUrl4k: data?.mediaInfo?.mediaUrl4k,
    iOSPlexUrl: data?.mediaInfo?.iOSPlexUrl,
    iOSPlexUrl4k: data?.mediaInfo?.iOSPlexUrl4k,
  });
  const safeMediaUrl = getSafeHref(mediaUrl);
  const safeMediaUrl4k = getSafeHref(mediaUrl4k);

  const CommentSchema = Yup.object().shape({
    message: Yup.string()
      .max(
        MAX_ISSUE_MESSAGE_LENGTH,
        intl.formatMessage(messages.validationCommentLength, {
          maxLength: MAX_ISSUE_MESSAGE_LENGTH,
        })
      )
      .required(),
  });

  const issueOption = issueOptions.find(
    (opt) => opt.issueType === issueData?.issueType
  );
  const settings = useSettings();

  if (issueData && !detailUrl) {
    return <ErrorPage statusCode={404} />;
  }

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data || !issueData) {
    return <ErrorPage statusCode={404} />;
  }

  const belongsToUser = issueData.createdBy.id === currentUser?.id;

  const [firstComment, ...otherComments] = issueData.comments;

  const editFirstComment = async (newMessage: string) => {
    try {
      await axios.put(`/api/v1/issueComment/${firstComment.id}`, {
        message: newMessage,
      });

      addToast(intl.formatMessage(messages.toasteditdescriptionsuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      revalidateIssue();
    } catch {
      addToast(intl.formatMessage(messages.toasteditdescriptionfailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const updateIssueStatus = async (newStatus: 'open' | 'resolved') => {
    try {
      await axios.post(`/api/v1/issue/${issueData.id}/${newStatus}`);

      addToast(intl.formatMessage(messages.toaststatusupdated), {
        appearance: 'success',
        autoDismiss: true,
      });
      revalidateIssue();
      mutate('/api/v1/issue/count');
    } catch {
      addToast(intl.formatMessage(messages.toaststatusupdatefailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const deleteIssue = async () => {
    try {
      await axios.delete(`/api/v1/issue/${issueData.id}`);
      mutate('/api/v1/issue/count');

      addToast(intl.formatMessage(messages.toastissuedeleted), {
        appearance: 'success',
        autoDismiss: true,
      });
      router.push('/issues');
    } catch {
      addToast(intl.formatMessage(messages.toastissuedeletefailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const title =
    isMovie(data) || isMusic(data) || isBook(data) ? data.title : data.name;
  const releaseYear = isMovie(data)
    ? data.releaseDate
    : isMusic(data)
      ? data.releaseDate
      : isBook(data)
        ? data.firstPublishYear?.toString()
        : data.firstAirDate;
  const mediaLink =
    issueData.media.mediaType === MediaType.MOVIE
      ? `/movie/${issueData.media.tmdbId}`
      : issueData.media.mediaType === MediaType.TV
        ? `/tv/${issueData.media.tmdbId}`
        : issueData.media.mediaType === MediaType.MUSIC && normalizedMusicId
          ? `/music/${encodeApiPathSegment(normalizedMusicId)}`
          : normalizedBookId
            ? `/book/${encodeApiPathSegment(normalizedBookId)}`
            : '/';
  const posterPath =
    isMusic(data) || isBook(data)
      ? data.posterPath
      : data.posterPath
        ? getTmdbPosterImageUrl(data.posterPath)
        : undefined;
  const backdropPath = isMusic(data)
    ? data.artistBackdrop
    : isBook(data)
      ? data.posterPath
      : data.backdropPath
        ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.backdropPath}`
        : undefined;
  const arrName =
    issueData.media.mediaType === MediaType.MOVIE
      ? 'Radarr'
      : issueData.media.mediaType === MediaType.TV
        ? 'Sonarr'
        : issueData.media.mediaType === MediaType.MUSIC
          ? 'Lidarr'
          : 'Bookshelf';
  const serviceLinks = (
    [
      issueData.media.serviceUrl
        ? {
            key: 'primary',
            url: issueData.media.serviceUrl,
            formatLabel:
              issueData.media.mediaType === MediaType.BOOK
                ? intl.formatMessage(messages.ebook)
                : undefined,
          }
        : undefined,
      issueData.media.mediaType === MediaType.BOOK &&
      issueData.media.audiobookServiceUrl
        ? {
            key: 'audiobook',
            url: issueData.media.audiobookServiceUrl,
            formatLabel: intl.formatMessage(messages.audiobook),
          }
        : undefined,
    ] as (IssueServiceLink | undefined)[]
  )
    .map((link) =>
      link ? { ...link, url: getSafeHref(link.url) ?? '' } : undefined
    )
    .filter((link): link is IssueServiceLink => Boolean(link && link.url));
  const safeServiceUrl4k = getSafeHref(issueData.media.serviceUrl4k);

  return (
    <div
      className="media-page"
      style={{
        height: 493,
      }}
    >
      <PageTitle title={[intl.formatMessage(messages.issuepagetitle), title]} />
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={showDeleteModal}
      >
        <Modal
          title={intl.formatMessage(messages.deleteissue)}
          onCancel={() => setShowDeleteModal(false)}
          onOk={() => deleteIssue()}
          okText={intl.formatMessage(messages.deleteissue)}
          okButtonType="danger"
        >
          {intl.formatMessage(messages.deleteissueconfirm)}
        </Modal>
      </Transition>
      {backdropPath && (
        <div className="media-page-bg-image">
          <CachedImage
            type={isBook(data) ? 'book' : isMusic(data) ? 'music' : 'tmdb'}
            alt=""
            src={backdropPath}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
            priority
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(180deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 100%)',
            }}
          />
        </div>
      )}
      <div className="media-header">
        <div className="media-poster">
          <CachedImage
            type={isBook(data) ? 'book' : isMusic(data) ? 'music' : 'tmdb'}
            src={posterPath ?? '/images/seerr_poster_not_found.png'}
            variants={
              !isMusic(data) && !isBook(data)
                ? getTmdbPosterImageVariants(data.posterPath)
                : undefined
            }
            alt=""
            sizes="100vw"
            style={{ width: '100%', height: 'auto' }}
            width={600}
            height={900}
            priority
          />
        </div>
        <div className="media-title">
          <div className="media-status">
            {issueData.status === IssueStatus.OPEN && (
              <Badge badgeType="warning">
                {intl.formatMessage(globalMessages.open)}
              </Badge>
            )}
            {issueData.status === IssueStatus.RESOLVED && (
              <Badge badgeType="success">
                {intl.formatMessage(globalMessages.resolved)}
              </Badge>
            )}
          </div>
          <h1>
            <Link href={mediaLink} className="hover:underline">
              {title}
            </Link>{' '}
            {releaseYear && (
              <span className="media-year">({releaseYear.slice(0, 4)})</span>
            )}
          </h1>
          <span className="media-attributes">
            {intl.formatMessage(messages.openedby, {
              issueId: issueData.id,
              username: (
                <Link
                  href={
                    belongsToUser
                      ? '/profile'
                      : `/users/${issueData.createdBy.id}`
                  }
                  className="group ml-1 inline-flex h-full items-center xl:ml-1.5"
                >
                  <CachedImage
                    type="avatar"
                    src={issueData.createdBy.avatar}
                    alt=""
                    className="mr-0.5 h-5 w-5 scale-100 transform-gpu rounded-full object-cover transition duration-300 group-hover:scale-105 xl:mr-1 xl:h-6 xl:w-6"
                    width={20}
                    height={20}
                  />
                  <span className="font-semibold text-gray-100 transition duration-300 group-hover:text-white group-hover:underline">
                    {issueData.createdBy.displayName}
                  </span>
                </Link>
              ),
              relativeTime: (
                <FormattedRelativeTime
                  value={Math.floor(
                    (new Date(issueData.createdAt).getTime() - Date.now()) /
                      1000
                  )}
                  updateIntervalInSeconds={1}
                  numeric="auto"
                />
              ),
            })}
          </span>
        </div>
      </div>
      <div className="relative z-10 mt-6 flex text-gray-300">
        <div className="flex-1 lg:pr-4">
          <IssueDescription
            description={firstComment.message}
            belongsToUser={belongsToUser}
            commentCount={otherComments.length}
            onEdit={(newMessage) => {
              editFirstComment(newMessage);
            }}
            onDelete={() => setShowDeleteModal(true)}
          />
          <div className="mt-8 lg:hidden">
            <div className="media-facts">
              <div className="media-fact">
                <span>{intl.formatMessage(messages.issuetype)}</span>
                <span className="media-fact-value">
                  {intl.formatMessage(
                    issueOption?.name ?? messages.unknownissuetype
                  )}
                </span>
              </div>
              {issueData.media.mediaType === MediaType.TV && (
                <>
                  <div className="media-fact">
                    <span>{intl.formatMessage(messages.problemseason)}</span>
                    <span className="media-fact-value">
                      {intl.formatMessage(
                        issueData.problemSeason > 0
                          ? messages.season
                          : messages.allseasons,
                        { seasonNumber: issueData.problemSeason }
                      )}
                    </span>
                  </div>
                  {issueData.problemSeason > 0 && (
                    <div className="media-fact">
                      <span>{intl.formatMessage(messages.problemepisode)}</span>
                      <span className="media-fact-value">
                        {intl.formatMessage(
                          issueData.problemEpisode > 0
                            ? messages.episode
                            : messages.allepisodes,
                          { episodeNumber: issueData.problemEpisode }
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="media-fact">
                <span>{intl.formatMessage(messages.lastupdated)}</span>
                <span className="media-fact-value">
                  <FormattedRelativeTime
                    value={Math.floor(
                      (new Date(issueData.updatedAt).getTime() - Date.now()) /
                        1000
                    )}
                    updateIntervalInSeconds={1}
                    numeric="auto"
                  />
                </span>
              </div>
            </div>
            <div className="mb-6 mt-4 flex flex-col space-y-2">
              {safeMediaUrl && (
                <Button
                  as="a"
                  href={safeMediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full"
                  buttonType="ghost"
                >
                  <PlayIcon />
                  <span>
                    {settings.currentSettings.mediaServerType ===
                    MediaServerType.EMBY
                      ? intl.formatMessage(messages.playonplex, {
                          mediaServerName: 'Emby',
                        })
                      : settings.currentSettings.mediaServerType ===
                          MediaServerType.PLEX
                        ? intl.formatMessage(messages.playonplex, {
                            mediaServerName: 'Plex',
                          })
                        : intl.formatMessage(messages.playonplex, {
                            mediaServerName: 'Jellyfin',
                          })}
                  </span>
                </Button>
              )}
              {hasPermission(Permission.ADMIN) &&
                serviceLinks.map((serviceLink) => (
                  <Button
                    key={`mobile-service-link-${serviceLink.key}`}
                    as="a"
                    href={serviceLink.url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full"
                    buttonType="ghost"
                  >
                    <ServerIcon />
                    <span>
                      {serviceLink.formatLabel
                        ? intl.formatMessage(messages.openinarrFormat, {
                            arr: arrName,
                            format: serviceLink.formatLabel,
                          })
                        : intl.formatMessage(messages.openinarr, {
                            arr: arrName,
                          })}
                    </span>
                  </Button>
                ))}
              {safeMediaUrl4k && (
                <Button
                  as="a"
                  href={safeMediaUrl4k}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full"
                  buttonType="ghost"
                >
                  <PlayIcon />
                  <span>
                    {settings.currentSettings.mediaServerType ===
                    MediaServerType.EMBY
                      ? intl.formatMessage(messages.play4konplex, {
                          mediaServerName: 'Emby',
                        })
                      : settings.currentSettings.mediaServerType ===
                          MediaServerType.PLEX
                        ? intl.formatMessage(messages.play4konplex, {
                            mediaServerName: 'Plex',
                          })
                        : intl.formatMessage(messages.play4konplex, {
                            mediaServerName: 'Jellyfin',
                          })}
                  </span>
                </Button>
              )}
              {safeServiceUrl4k && hasPermission(Permission.ADMIN) && (
                <Button
                  as="a"
                  href={safeServiceUrl4k}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full"
                  buttonType="ghost"
                >
                  <ServerIcon />
                  <span>
                    {intl.formatMessage(messages.openin4karr, {
                      arr: arrName,
                    })}
                  </span>
                </Button>
              )}
            </div>
          </div>
          <div className="mt-6">
            <div className="font-semibold text-gray-100 lg:text-xl">
              {intl.formatMessage(messages.comments)}
            </div>
            {otherComments.map((comment) => (
              <IssueComment
                comment={comment}
                key={`issue-comment-${comment.id}`}
                isReversed={issueData.createdBy.id === comment.user.id}
                isActiveUser={comment.user.id === currentUser?.id}
                onUpdate={() => revalidateIssue()}
              />
            ))}
            {otherComments.length === 0 && (
              <div className="mb-10 mt-4 text-gray-400">
                <span>{intl.formatMessage(messages.nocomments)}</span>
              </div>
            )}
            {(hasPermission(Permission.MANAGE_ISSUES) || belongsToUser) && (
              <Formik
                initialValues={{
                  message: '',
                }}
                validationSchema={CommentSchema}
                onSubmit={async (values, { resetForm }) => {
                  await axios.post(`/api/v1/issue/${issueData?.id}/comment`, {
                    message: values.message,
                  });
                  revalidateIssue();
                  resetForm();
                }}
              >
                {({ isValid, isSubmitting, values, handleSubmit }) => {
                  return (
                    <Form>
                      <div className="my-6">
                        <Field
                          id="message"
                          name="message"
                          as="textarea"
                          placeholder={intl.formatMessage(
                            messages.commentplaceholder
                          )}
                          className="h-20"
                        />
                        <div className="mt-4 flex items-center justify-end space-x-2">
                          {(hasPermission(Permission.MANAGE_ISSUES) ||
                            belongsToUser) && (
                            <>
                              {issueData.status === IssueStatus.OPEN ? (
                                <Button
                                  type="button"
                                  buttonType="danger"
                                  onClick={async () => {
                                    await updateIssueStatus('resolved');

                                    if (values.message) {
                                      handleSubmit();
                                    }
                                  }}
                                >
                                  <CheckCircleIcon />
                                  <span>
                                    {intl.formatMessage(
                                      values.message
                                        ? messages.closeissueandcomment
                                        : messages.closeissue
                                    )}
                                  </span>
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  buttonType="default"
                                  onClick={async () => {
                                    await updateIssueStatus('open');

                                    if (values.message) {
                                      handleSubmit();
                                    }
                                  }}
                                >
                                  <ArrowPathIcon />
                                  <span>
                                    {intl.formatMessage(
                                      values.message
                                        ? messages.reopenissueandcomment
                                        : messages.reopenissue
                                    )}
                                  </span>
                                </Button>
                              )}
                            </>
                          )}
                          <Button
                            type="submit"
                            buttonType="primary"
                            disabled={
                              !isValid || isSubmitting || !values.message
                            }
                          >
                            <ChatBubbleOvalLeftEllipsisIcon />
                            <span>
                              {intl.formatMessage(messages.leavecomment)}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </Form>
                  );
                }}
              </Formik>
            )}
          </div>
        </div>
        <div className="hidden lg:block lg:w-80 lg:pl-4">
          <div className="media-facts">
            <div className="media-fact">
              <span>{intl.formatMessage(messages.issuetype)}</span>
              <span className="media-fact-value">
                {intl.formatMessage(
                  issueOption?.name ?? messages.unknownissuetype
                )}
              </span>
            </div>
            {issueData.media.mediaType === MediaType.TV && (
              <>
                <div className="media-fact">
                  <span>{intl.formatMessage(messages.problemseason)}</span>
                  <span className="media-fact-value">
                    {intl.formatMessage(
                      issueData.problemSeason > 0
                        ? messages.season
                        : messages.allseasons,
                      { seasonNumber: issueData.problemSeason }
                    )}
                  </span>
                </div>
                {issueData.problemSeason > 0 && (
                  <div className="media-fact">
                    <span>{intl.formatMessage(messages.problemepisode)}</span>
                    <span className="media-fact-value">
                      {intl.formatMessage(
                        issueData.problemEpisode > 0
                          ? messages.episode
                          : messages.allepisodes,
                        { episodeNumber: issueData.problemEpisode }
                      )}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="media-fact">
              <span>{intl.formatMessage(messages.lastupdated)}</span>
              <span className="media-fact-value">
                <FormattedRelativeTime
                  value={Math.floor(
                    (new Date(issueData.updatedAt).getTime() - Date.now()) /
                      1000
                  )}
                  updateIntervalInSeconds={1}
                  numeric="auto"
                />
              </span>
            </div>
          </div>
          <div className="mb-6 mt-4 flex flex-col space-y-2">
            {safeMediaUrl && (
              <Button
                as="a"
                href={safeMediaUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full"
                buttonType="ghost"
              >
                <PlayIcon />
                <span>
                  {settings.currentSettings.mediaServerType ===
                  MediaServerType.EMBY
                    ? intl.formatMessage(messages.playonplex, {
                        mediaServerName: 'Emby',
                      })
                    : settings.currentSettings.mediaServerType ===
                        MediaServerType.PLEX
                      ? intl.formatMessage(messages.playonplex, {
                          mediaServerName: 'Plex',
                        })
                      : intl.formatMessage(messages.playonplex, {
                          mediaServerName: 'Jellyfin',
                        })}
                </span>
              </Button>
            )}
            {hasPermission(Permission.ADMIN) &&
              serviceLinks.map((serviceLink) => (
                <Button
                  key={`service-link-${serviceLink.key}`}
                  as="a"
                  href={serviceLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full"
                  buttonType="ghost"
                >
                  <ServerIcon />
                  <span>
                    {serviceLink.formatLabel
                      ? intl.formatMessage(messages.openinarrFormat, {
                          arr: arrName,
                          format: serviceLink.formatLabel,
                        })
                      : intl.formatMessage(messages.openinarr, {
                          arr: arrName,
                        })}
                  </span>
                </Button>
              ))}
            {safeMediaUrl4k && (
              <Button
                as="a"
                href={safeMediaUrl4k}
                target="_blank"
                rel="noreferrer"
                className="w-full"
                buttonType="ghost"
              >
                <PlayIcon />
                <span>
                  {settings.currentSettings.mediaServerType ===
                  MediaServerType.EMBY
                    ? intl.formatMessage(messages.play4konplex, {
                        mediaServerName: 'Emby',
                      })
                    : settings.currentSettings.mediaServerType ===
                        MediaServerType.PLEX
                      ? intl.formatMessage(messages.play4konplex, {
                          mediaServerName: 'Plex',
                        })
                      : intl.formatMessage(messages.play4konplex, {
                          mediaServerName: 'Jellyfin',
                        })}
                </span>
              </Button>
            )}
            {safeServiceUrl4k && hasPermission(Permission.ADMIN) && (
              <Button
                as="a"
                href={safeServiceUrl4k}
                target="_blank"
                rel="noreferrer"
                className="w-full"
                buttonType="ghost"
              >
                <ServerIcon />
                <span>
                  {intl.formatMessage(messages.openin4karr, {
                    arr: arrName,
                  })}
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="extra-bottom-space" />
    </div>
  );
};

export default IssueDetails;
