import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const BookRequestModal = dynamic(
  () => import('@app/components/RequestModal/BookRequestModal'),
  { ssr: false }
);
const CollectionRequestModal = dynamic(
  () => import('@app/components/RequestModal/CollectionRequestModal'),
  { ssr: false }
);
const MovieRequestModal = dynamic(
  () => import('@app/components/RequestModal/MovieRequestModal'),
  { ssr: false }
);
const MusicRequestModal = dynamic(
  () => import('@app/components/RequestModal/MusicRequestModal'),
  { ssr: false }
);
const TvRequestModal = dynamic(
  () => import('@app/components/RequestModal/TvRequestModal'),
  { ssr: false }
);

interface RequestModalProps {
  show: boolean;
  type: 'movie' | 'tv' | 'collection' | 'music' | 'book';
  tmdbId?: number;
  mbId?: string;
  bookId?: string;
  initialBookFormat?: 'ebook' | 'audiobook';
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  show4kSelector?: boolean;
  onComplete?: (newStatus: MediaStatus) => void;
  onCancel?: () => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const messages = defineMessages('components.RequestModal', {
  requestQuality: 'Request Quality',
  standard: 'Standard',
});

const RequestModal = ({
  type,
  show,
  tmdbId,
  mbId,
  bookId,
  initialBookFormat,
  is4k,
  editRequest,
  show4kSelector = false,
  onComplete,
  onUpdating,
  onCancel,
}: RequestModalProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { hasPermission } = useUser();
  const canRequestStandard =
    (type === 'movie' || type === 'tv') &&
    hasPermission(
      [
        Permission.REQUEST,
        type === 'movie' ? Permission.REQUEST_MOVIE : Permission.REQUEST_TV,
      ],
      { type: 'or' }
    );
  const canRequest4k =
    (type === 'movie' || type === 'tv') &&
    hasPermission(
      [
        Permission.REQUEST_4K,
        type === 'movie'
          ? Permission.REQUEST_4K_MOVIE
          : Permission.REQUEST_4K_TV,
      ],
      { type: 'or' }
    );
  const [selectedIs4k, setSelectedIs4k] = useState(
    is4k ?? (!canRequestStandard && canRequest4k)
  );
  const canSelect4k =
    show4kSelector &&
    !editRequest &&
    (type === 'movie' || type === 'tv') &&
    ((type === 'movie' && settings.currentSettings.movie4kEnabled) ||
      (type === 'tv' && settings.currentSettings.series4kEnabled)) &&
    canRequest4k;
  const modalIs4k = is4k ?? selectedIs4k;
  const requestQualityControl = canSelect4k ? (
    <div className="mb-4 mt-4">
      <label htmlFor="request-quality">
        {intl.formatMessage(messages.requestQuality)}
      </label>
      <select
        id="request-quality"
        name="request-quality"
        value={modalIs4k ? '4k' : 'standard'}
        onChange={(event) => setSelectedIs4k(event.target.value === '4k')}
        className="border-gray-700 bg-gray-800"
      >
        {canRequestStandard && (
          <option value="standard">
            {intl.formatMessage(messages.standard)}
          </option>
        )}
        <option value="4k">
          {intl.formatMessage(globalMessages.request4k)}
        </option>
      </select>
    </div>
  ) : null;

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      {type === 'music' && mbId ? (
        <MusicRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          mbId={mbId}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'book' && bookId ? (
        <BookRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          bookId={bookId}
          initialBookFormat={initialBookFormat}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'movie' && tmdbId ? (
        <MovieRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={modalIs4k}
          editRequest={editRequest}
          requestQualityControl={requestQualityControl}
        />
      ) : type === 'tv' && tmdbId ? (
        <TvRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={modalIs4k}
          editRequest={editRequest}
          requestQualityControl={requestQualityControl}
        />
      ) : tmdbId ? (
        <CollectionRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={is4k}
        />
      ) : null}
    </Transition>
  );
};

export default RequestModal;
