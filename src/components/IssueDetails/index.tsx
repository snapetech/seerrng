import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import IssueAffectedEpisodes from '@app/components/IssueDetails/IssueAffectedEpisodes';
import IssueComment from '@app/components/IssueDetails/IssueComment';
import IssueMediaSummary, {
  isIssueBook,
  isIssueMovie,
  isIssueMusic,
  type IssueMediaDetails,
} from '@app/components/IssueDetails/IssueMediaSummary';
import { issueOptions } from '@app/components/IssueModal/constants';
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
import { getSafeHref } from '@app/utils/safeUrl';
import {
  ArrowPathIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  CheckCircleIcon,
  ServerIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { IssueStatus, MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormattedDate, useIntl } from 'react-intl';
import ReactMarkdown from 'react-markdown';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueDetails', {
  issuepagetitle: 'Issue',
  description: 'Description',
  comments: 'Comments',
  nocomments: 'No Comments',
  commentplaceholder: 'Add a comment...',
  closeissue: 'Close Issue',
  reopenissue: 'Reopen Issue',
  addcomment: 'Add Comment',
  openinarr: 'Open in {arr}',
  openBookInBookshelf: 'Open Book in Bookshelf',
  openAudiobookInBookshelf: 'Open Audiobook in Bookshelf',
  toaststatusupdated: 'Issue status updated successfully!',
  toaststatusupdatefailed:
    'Something went wrong while updating the issue status.',
  validationCommentLength:
    'Comment must be {maxLength, number} characters or fewer',
  unknownissuetype: 'Unknown',
});

const IssueDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user: currentUser, hasPermission } = useUser();
  const issueId =
    typeof router.query.issueId === 'string' ? router.query.issueId : '';
  const { data: issueData, mutate: revalidateIssue } = useSWR<Issue>(
    issueId ? `/api/v1/issue/${issueId}` : null
  );
  const bookId = issueData?.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;
  const musicId = issueData?.media.mbId
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
        : issueData?.media.mediaType === MediaType.MUSIC && musicId
          ? `/api/v1/music/${encodeApiPathSegment(musicId)}`
          : issueData?.media.mediaType === MediaType.BOOK && normalizedBookId
            ? `/api/v1/book/${encodeApiPathSegment(normalizedBookId)}`
            : null;
  const { data, error } = useSWR<IssueMediaDetails>(detailUrl);
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
  const canManage = hasPermission(Permission.MANAGE_ISSUES);
  const canComment = canManage || belongsToUser;
  const [descriptionComment, ...comments] = issueData.comments;
  const issueOption = issueOptions.find(
    (option) => option.issueType === issueData.issueType
  );
  const isMovie = isIssueMovie(data);
  const isMusic = isIssueMusic(data);
  const isBook = isIssueBook(data);
  const title = isMovie || isMusic || isBook ? data.title : data.name;
  const mediaHref =
    issueData.media.mediaType === MediaType.MOVIE
      ? `/movie/${issueData.media.tmdbId}`
      : issueData.media.mediaType === MediaType.TV
        ? `/tv/${issueData.media.tmdbId}`
        : issueData.media.mediaType === MediaType.MUSIC && musicId
          ? `/music/${encodeApiPathSegment(musicId)}`
          : normalizedBookId
            ? `/book/${encodeApiPathSegment(normalizedBookId)}`
            : '/';
  const backdropPath = isMusic
    ? data.artistBackdrop
    : isBook
      ? data.posterPath
      : data.backdropPath
        ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.backdropPath}`
        : undefined;
  const selectedServiceUrl = getSafeHref(
    issueData.is4k
      ? (issueData.media.serviceUrl4k ?? issueData.media.serviceUrl)
      : (issueData.media.serviceUrl ?? issueData.media.serviceUrl4k)
  );
  const bookServiceLinks = isBook
    ? [
        {
          url: getSafeHref(issueData.media.serviceUrl),
          label: intl.formatMessage(messages.openBookInBookshelf),
        },
        {
          url: getSafeHref(issueData.media.audiobookServiceUrl),
          label: intl.formatMessage(messages.openAudiobookInBookshelf),
        },
      ].filter((link): link is { url: string; label: string } =>
        Boolean(link.url)
      )
    : [];
  const arrName =
    issueData.media.mediaType === MediaType.MOVIE
      ? 'Radarr'
      : issueData.media.mediaType === MediaType.TV
        ? 'Sonarr'
        : issueData.media.mediaType === MediaType.MUSIC
          ? 'Lidarr'
          : 'Bookshelf';
  const updateIssueStatus = async (status: 'open' | 'resolved') => {
    try {
      await axios.post(`/api/v1/issue/${issueData.id}/${status}`);
      await revalidateIssue();
      mutate('/api/v1/issue/count');
      addToast(intl.formatMessage(messages.toaststatusupdated), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.toaststatusupdatefailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const leaveIssue = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      void router.push('/issues');
    }
  };

  const commentSchema = Yup.object().shape({
    message: Yup.string()
      .max(
        MAX_ISSUE_MESSAGE_LENGTH,
        intl.formatMessage(messages.validationCommentLength, {
          maxLength: MAX_ISSUE_MESSAGE_LENGTH,
        })
      )
      .required(),
  });

  return (
    <div className="media-page min-h-screen pb-8">
      <PageTitle title={[intl.formatMessage(messages.issuepagetitle), title]} />
      <div className="relative z-10 pt-4">
        <h1 className="mb-2 text-2xl font-bold text-indigo-300 sm:text-3xl">
          {intl.formatMessage(messages.issuepagetitle)}
        </h1>

        <article className="media-detail-card refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-2 shadow-lg shadow-gray-950/20">
          {backdropPath && (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl"
              aria-hidden
            >
              <CachedImage
                type={isBook ? 'book' : isMusic ? 'music' : 'tmdb'}
                alt=""
                src={backdropPath}
                fill
                priority
                className="object-cover object-top"
              />
              <div className="absolute inset-0 bg-gray-900/55" />
            </div>
          )}
          <div className="relative z-10">
            <IssueMediaSummary
              data={data}
              mediaType={issueData.media.mediaType}
              is4k={issueData.is4k}
              mediaHref={mediaHref}
              embedded
              rightDetails={[
                {
                  label: 'Created By',
                  value: (
                    <Link
                      href={
                        belongsToUser
                          ? '/profile'
                          : `/users/${issueData.createdBy.id}`
                      }
                      className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    >
                      {issueData.createdBy.displayName}
                    </Link>
                  ),
                },
                {
                  label: 'Created On',
                  value: (
                    <FormattedDate
                      value={issueData.createdAt}
                      dateStyle="medium"
                    />
                  ),
                },
                {
                  value: (
                    <FormattedDate
                      value={issueData.createdAt}
                      timeStyle="short"
                    />
                  ),
                },
                {
                  label: 'Issue Type',
                  value: intl.formatMessage(
                    issueOption?.name ?? messages.unknownissuetype
                  ),
                },
              ]}
            />

            {issueData.media.mediaType === MediaType.TV &&
              !isMovie &&
              !isMusic &&
              !isBook && (
                <IssueAffectedEpisodes issue={issueData} tvId={data.id} />
              )}

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.description)}
              </h2>
              <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-3 text-xs leading-4">
                <time
                  className="refreshed-detail-text-muted whitespace-nowrap"
                  dateTime={new Date(issueData.createdAt).toISOString()}
                >
                  <FormattedDate
                    value={issueData.createdAt}
                    dateStyle="medium"
                  />
                  <span aria-hidden="true"> </span>
                  <FormattedDate
                    value={issueData.createdAt}
                    timeStyle="short"
                  />
                </time>
                <div className="refreshed-detail-text-muted prose prose-sm prose-p:my-0 prose-p:leading-4 prose-ol:my-0 prose-ul:my-0 prose-li:my-0 prose-li:leading-4 max-w-full text-xs leading-4">
                  <ReactMarkdown
                    skipHtml
                    allowedElements={['p', 'em', 'strong', 'ul', 'ol', 'li']}
                  >
                    {descriptionComment?.message ?? ''}
                  </ReactMarkdown>
                </div>
              </div>
            </section>

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.comments)}
              </h2>
              {comments.length > 0 ? (
                <div>
                  {comments.map((comment) => (
                    <IssueComment
                      comment={comment}
                      key={comment.id}
                      isActiveUser={comment.user.id === currentUser?.id}
                      onUpdate={() => void revalidateIssue()}
                    />
                  ))}
                </div>
              ) : (
                <p className="refreshed-detail-text-muted py-2 text-xs">
                  {intl.formatMessage(messages.nocomments)}
                </p>
              )}

              <Formik
                initialValues={{ message: '' }}
                validationSchema={commentSchema}
                onSubmit={async (values, { resetForm }) => {
                  await axios.post(`/api/v1/issue/${issueData.id}/comment`, {
                    message: values.message,
                  });
                  await revalidateIssue();
                  resetForm();
                }}
              >
                {({ isValid, isSubmitting, values, handleSubmit }) => (
                  <Form>
                    {canComment && (
                      <Field
                        as="textarea"
                        rows={3}
                        id="message"
                        name="message"
                        placeholder={intl.formatMessage(
                          messages.commentplaceholder
                        )}
                        className="mt-[5px] max-h-32 w-full resize-none overflow-y-auto rounded-md border-gray-600 bg-gray-900/60 text-sm text-gray-100 placeholder:text-gray-500"
                      />
                    )}

                    <div className="mt-[5px] flex flex-wrap items-center justify-end gap-2">
                      <div className="mr-auto flex flex-wrap gap-2">
                        {canComment && (
                          <Button
                            type="button"
                            onClick={() => handleSubmit()}
                            disabled={
                              !isValid || isSubmitting || !values.message
                            }
                            buttonType="warning"
                            buttonSize="sm"
                          >
                            <ChatBubbleOvalLeftEllipsisIcon />
                            {intl.formatMessage(messages.addcomment)}
                          </Button>
                        )}
                        {!isBook &&
                          selectedServiceUrl &&
                          hasPermission(Permission.ADMIN) && (
                            <Button
                              as="a"
                              href={selectedServiceUrl}
                              target="_blank"
                              rel="noreferrer"
                              buttonType="primary"
                              buttonSize="sm"
                            >
                              <ServerIcon />
                              {intl.formatMessage(messages.openinarr, {
                                arr: arrName,
                              })}
                            </Button>
                          )}
                        {isBook &&
                          hasPermission(Permission.ADMIN) &&
                          bookServiceLinks.map((link) => (
                            <Button
                              as="a"
                              key={link.label}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              buttonType="primary"
                              buttonSize="sm"
                            >
                              <ServerIcon />
                              {link.label}
                            </Button>
                          ))}
                      </div>

                      <Button
                        type="button"
                        onClick={leaveIssue}
                        buttonType="danger"
                        buttonSize="sm"
                      >
                        <XMarkIcon />
                        {intl.formatMessage(globalMessages.cancel)}
                      </Button>
                      {canComment && (
                        <Button
                          type="button"
                          onClick={() =>
                            void updateIssueStatus(
                              issueData.status === IssueStatus.OPEN
                                ? 'resolved'
                                : 'open'
                            )
                          }
                          buttonType="success"
                          buttonSize="sm"
                        >
                          {issueData.status === IssueStatus.OPEN ? (
                            <CheckCircleIcon />
                          ) : (
                            <ArrowPathIcon />
                          )}
                          {intl.formatMessage(
                            issueData.status === IssueStatus.OPEN
                              ? messages.closeissue
                              : messages.reopenissue
                          )}
                        </Button>
                      )}
                    </div>
                  </Form>
                )}
              </Formik>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
};

export default IssueDetails;
