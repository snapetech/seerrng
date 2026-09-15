import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import {
  CompactSelect,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import IssueMediaSummary from '@app/components/IssueDetails/IssueMediaSummary';
import { getAvailableIssueQualities } from '@app/components/IssueDetails/issueMediaFormat';
import SeriesEpisodeSelector from '@app/components/IssueModal/CreateIssueModal/SeriesEpisodeSelector';
import { getIssueOptionsForMediaType } from '@app/components/IssueModal/constants';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { PaperAirplaneIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ArrowRightCircleIcon } from '@heroicons/react/24/solid';
import { IssueType, MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { Field, Formik } from 'formik';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueModal.CreateIssueModal', {
  validationMessageRequired: 'You must provide a description',
  validationMessageLength:
    'Description must be {maxLength, number} characters or fewer',
  whatswrong: "What's wrong?",
  providedetail:
    'Please provide a detailed explanation of the issue you encountered.',
  quality: 'Quality',
  issueType: 'Issue Type',
  hd: 'HD',
  ultraHd: '4K',
  noAvailableQuality: 'No available quality',
  selectepisode: 'Select at least one affected season or episode',
  toastSuccessCreate:
    'Issue report for <strong>{title}</strong> submitted successfully!',
  toastFailedCreate: 'Something went wrong while submitting the issue.',
  toastviewissue: 'View Issue',
  reportissue: 'Report an Issue',
  submitissue: 'Submit Issue',
});

type IssueMediaDetails = MovieDetails | TvDetails | MusicDetails | BookDetails;

const isMusic = (media: IssueMediaDetails): media is MusicDetails => {
  return (media as MusicDetails).mediaType === 'album';
};

const isBook = (media: IssueMediaDetails): media is BookDetails => {
  return (media as BookDetails).mediaType === 'book';
};

const isMovie = (movie: IssueMediaDetails): movie is MovieDetails => {
  if (isMusic(movie) || isBook(movie)) {
    return false;
  }

  return (movie as MovieDetails).title !== undefined;
};

interface CreateIssueModalProps {
  mediaType: 'movie' | 'tv' | 'music' | 'book';
  tmdbId?: number;
  mediaId?: number;
  title?: string;
  backdrop?: string;
  onCancel?: () => void;
}

const CreateIssueModal = ({
  onCancel,
  mediaType,
  tmdbId,
  mediaId,
  title,
  backdrop,
}: CreateIssueModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const detailUrl =
    mediaType === 'movie' || mediaType === 'tv'
      ? tmdbId
        ? `/api/v1/${mediaType}/${tmdbId}`
        : null
      : null;
  const { data, error } = useSWR<IssueMediaDetails>(detailUrl);

  if (!tmdbId && !mediaId) {
    return null;
  }

  const resolvedMediaId = mediaId ?? data?.mediaInfo?.id;
  const resolvedBackdrop =
    backdrop ??
    (data
      ? isMusic(data)
        ? (data.artistBackdrop ?? data.artistThumb ?? data.posterPath)
        : isBook(data)
          ? data.posterPath
          : data.backdropPath
            ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.backdropPath}`
            : data.posterPath
              ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.posterPath}`
              : undefined
      : undefined);
  const resolvedTitle =
    title ??
    (data
      ? isMovie(data) || isMusic(data) || isBook(data)
        ? data.title
        : data.name
      : undefined);
  const issueOptions = getIssueOptionsForMediaType(mediaType);
  const orderedIssueOptions = [
    IssueType.OTHER,
    IssueType.AUDIO,
    IssueType.VIDEO,
    IssueType.SUBTITLES,
  ].flatMap((issueType) =>
    issueOptions.filter((option) => option.issueType === issueType)
  );
  const defaultIssueType = IssueType.OTHER;
  const issueTypeOptions: CompactSelectOption[] = orderedIssueOptions.map(
    (option) => ({
      value: option.issueType.toString(),
      label: intl.formatMessage(option.name),
    })
  );
  const availableQualities = getAvailableIssueQualities(data?.mediaInfo);
  const hasAvailableVideoQuality = availableQualities.length > 0;
  const initialIs4k = availableQualities[0] === '4k';
  const qualityOptions: CompactSelectOption[] = availableQualities.map(
    (quality) => ({
      value: quality,
      label: intl.formatMessage(
        quality === '4k' ? messages.ultraHd : messages.hd
      ),
    })
  );
  const isAvailableStatus = (status?: MediaStatus) =>
    status === MediaStatus.AVAILABLE ||
    status === MediaStatus.PARTIALLY_AVAILABLE;
  const getAvailableSeasons = (is4k: boolean) =>
    (data?.mediaInfo?.seasons ?? [])
      .filter((season) =>
        isAvailableStatus(is4k ? season.status4k : season.status)
      )
      .map((season) => season.seasonNumber);
  const initialAvailableSeasons = getAvailableSeasons(initialIs4k);

  const CreateIssueModalSchema = Yup.object().shape({
    issueType: Yup.number()
      .oneOf(orderedIssueOptions.map((option) => option.issueType))
      .required(),
    message: Yup.string()
      .max(
        MAX_ISSUE_MESSAGE_LENGTH,
        intl.formatMessage(messages.validationMessageLength, {
          maxLength: MAX_ISSUE_MESSAGE_LENGTH,
        })
      )
      .required(intl.formatMessage(messages.validationMessageRequired)),
    problemEpisodeSelections:
      mediaType === 'tv'
        ? Yup.array()
            .of(
              Yup.object({
                seasonNumber: Yup.number().integer().min(0).required(),
                episodeNumbers: Yup.array().of(Yup.number().integer().min(1)),
              })
            )
            .min(1, intl.formatMessage(messages.selectepisode))
        : Yup.array(),
  });

  return (
    <Formik
      enableReinitialize
      initialValues={{
        issueType: defaultIssueType,
        message: '',
        is4k: initialIs4k,
        activeSeason: initialAvailableSeasons[0] ?? -1,
        problemEpisodeSelections: [] as SeasonEpisodeSelection[],
      }}
      validationSchema={CreateIssueModalSchema}
      onSubmit={async (values) => {
        try {
          const newIssue = await axios.post<Issue>('/api/v1/issue', {
            issueType: values.issueType,
            message: values.message,
            mediaId: resolvedMediaId,
            is4k: values.is4k,
            problemSeason:
              values.problemEpisodeSelections[0]?.seasonNumber ?? 0,
            problemEpisode:
              values.problemEpisodeSelections[0]?.episodeNumbers?.[0] ?? 0,
            problemEpisodes:
              values.problemEpisodeSelections[0]?.episodeNumbers ?? [],
            problemEpisodeSelections: values.problemEpisodeSelections,
          });

          if (resolvedTitle) {
            addToast(
              <>
                <div>
                  {intl.formatMessage(messages.toastSuccessCreate, {
                    title: resolvedTitle,
                    strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                  })}
                </div>
                <Link href={`/issues/${newIssue.data.id}`} legacyBehavior>
                  <Button as="a" className="mt-4">
                    <span>{intl.formatMessage(messages.toastviewissue)}</span>
                    <ArrowRightCircleIcon />
                  </Button>
                </Link>
              </>,
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );

            mutate('/api/v1/issue/count');
          }

          if (onCancel) {
            onCancel();
          }
        } catch {
          addToast(intl.formatMessage(messages.toastFailedCreate), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }}
    >
      {({
        handleSubmit,
        values,
        setFieldValue,
        errors,
        touched,
        isSubmitting,
      }) => {
        const issueTypeSelect = (
          <CompactSelect
            label={intl.formatMessage(messages.issueType)}
            value={values.issueType.toString()}
            options={issueTypeOptions}
            onChange={(issueType) =>
              void setFieldValue('issueType', Number(issueType) as IssueType)
            }
            defaultValue={defaultIssueType.toString()}
          />
        );

        return (
          <Modal
            backgroundClickable
            onCancel={onCancel}
            title={intl.formatMessage(messages.reportissue)}
            hideActions
            loading={!!detailUrl && !data && !error}
            backdrop={resolvedBackdrop}
            backdropFull
            dialogClass="artwork-form-main-card refreshed-card-surface refreshed-detail-text"
          >
            {data && (
              <IssueMediaSummary
                data={data}
                mediaType={mediaType}
                is4k={values.is4k}
                artwork={backdrop}
                embedded
                rightDetails={[
                  { label: 'Status', value: 'Ready to Report' },
                  {
                    label: 'Quality',
                    value: hasAvailableVideoQuality
                      ? values.is4k
                        ? intl.formatMessage(messages.ultraHd)
                        : intl.formatMessage(messages.hd)
                      : intl.formatMessage(messages.noAvailableQuality),
                  },
                ]}
                footer={
                  <>
                    {(mediaType === 'movie' || mediaType === 'tv') &&
                      hasAvailableVideoQuality && (
                        <CompactSelect
                          label={intl.formatMessage(messages.quality)}
                          value={values.is4k ? '4k' : 'hd'}
                          options={qualityOptions}
                          onChange={(quality) => {
                            const nextIs4k = quality === '4k';
                            const seasons = getAvailableSeasons(nextIs4k);
                            void setFieldValue('is4k', nextIs4k);
                            void setFieldValue(
                              'activeSeason',
                              seasons[0] ?? -1
                            );
                            void setFieldValue('problemEpisodeSelections', []);
                          }}
                          defaultValue={initialIs4k ? '4k' : 'hd'}
                        />
                      )}
                    {issueTypeSelect}
                  </>
                }
              />
            )}

            {!data && issueTypeSelect}

            {mediaType === 'tv' &&
              data &&
              !isMovie(data) &&
              !isMusic(data) &&
              !isBook(data) && (
                <>
                  <SeriesEpisodeSelector
                    tvId={data.id}
                    seasons={data.seasons.filter((season) =>
                      getAvailableSeasons(values.is4k).includes(
                        season.seasonNumber
                      )
                    )}
                    activeSeason={values.activeSeason}
                    selections={values.problemEpisodeSelections}
                    onActiveSeasonChange={(seasonNumber) =>
                      void setFieldValue('activeSeason', seasonNumber)
                    }
                    onSelectionsChange={(selections) =>
                      void setFieldValue('problemEpisodeSelections', selections)
                    }
                  />
                  {touched.problemEpisodeSelections &&
                    errors.problemEpisodeSelections && (
                      <div className="mt-1 text-xs text-red-300">
                        {String(errors.problemEpisodeSelections)}
                      </div>
                    )}
                </>
              )}

            <div className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="message"
                  className="text-xs font-semibold text-gray-100"
                >
                  {intl.formatMessage(messages.whatswrong)}
                  <span className="label-required">*</span>
                </label>
                <Field
                  as="textarea"
                  rows={3}
                  name="message"
                  id="message"
                  className="max-h-32 w-full resize-none overflow-y-auto rounded-md border-gray-600 bg-gray-900/60 text-sm text-gray-100 placeholder:text-gray-500"
                  placeholder={intl.formatMessage(messages.providedetail)}
                />
                {errors.message &&
                  touched.message &&
                  typeof errors.message === 'string' && (
                    <div className="error">{errors.message}</div>
                  )}
              </div>
            </div>

            <div className="mt-[5px] flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                onClick={onCancel}
                data-testid="modal-cancel-button"
                buttonType="danger"
                buttonSize="standard"
              >
                <span className="inline-flex items-center gap-1.5 [&_svg]:!m-0">
                  <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage(globalMessages.cancel)}</span>
                </span>
              </Button>
              <Button
                type="button"
                onClick={() => handleSubmit()}
                data-testid="modal-ok-button"
                buttonType="success"
                buttonSize="standard"
                disabled={
                  isSubmitting ||
                  ((mediaType === 'movie' || mediaType === 'tv') &&
                    !hasAvailableVideoQuality)
                }
              >
                <span className="inline-flex items-center gap-1.5 [&_svg]:!m-0">
                  <PaperAirplaneIcon className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage(messages.submitissue)}</span>
                </span>
              </Button>
            </div>
          </Modal>
        );
      }}
    </Formik>
  );
};

export default CreateIssueModal;
