import Badge from '@app/components/Common/Badge';
import BookFormatBadge, {
  getRequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import MediaTypeBadge, {
  getMediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import Tooltip from '@app/components/Common/Tooltip';
import useRequestOverride from '@app/hooks/useRequestOverride';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  CalendarIcon,
  CheckIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.RequestBlock', {
  seasons: '{seasonCount, plural, one {Season} other {Seasons}}',
  requestoverrides: 'Request Overrides',
  server: 'Destination Server',
  profilechanged: 'Quality Profile',
  metadataprofilechanged: 'Metadata Profile',
  rootfolder: 'Root Folder',
  languageprofile: 'Language Profile',
  requestdate: 'Request Date',
  requestedby: 'Requested By',
  lastmodifiedby: 'Last Modified By',
  bookFormat: 'Format',
  approve: 'Approve Request',
  decline: 'Decline Request',
  edit: 'Edit Request',
  delete: 'Delete Request',
});

interface RequestBlockProps {
  request: MediaRequest;
  onUpdate?: () => void;
}

const RequestBlock = ({ request, onUpdate }: RequestBlockProps) => {
  const { user } = useUser();
  const intl = useIntl();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const { profile, metadataProfile, rootFolder, server, languageProfile } =
    useRequestOverride(request);
  const rawBookId = request.media?.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;
  const bookId = rawBookId ? normalizeOpenLibraryWorkId(rawBookId) : undefined;
  const musicId = request.media?.mbId
    ? normalizeMusicBrainzId(request.media.mbId)
    : undefined;
  const comicId = request.media?.identifiers?.find(
    (identifier) => identifier.provider === 'comicvine'
  )?.value;
  const updateRequest = async (type: 'approve' | 'decline'): Promise<void> => {
    setIsUpdating(true);
    await axios.post(`/api/v1/request/${request.id}/${type}`);

    if (onUpdate) {
      onUpdate();
      mutate('/api/v1/request/count');
    }
    setIsUpdating(false);
  };

  const deleteRequest = async () => {
    setIsUpdating(true);
    await axios.delete(`/api/v1/request/${request.id}`);

    if (onUpdate) {
      onUpdate();
      mutate('/api/v1/request/count');
    }

    setIsUpdating(false);
  };

  return (
    <div className="block">
      {request.media && showEditModal && (
        <RequestModal
          show={showEditModal}
          tmdbId={
            request.type === 'music' ||
            request.type === 'book' ||
            request.type === 'comic'
              ? undefined
              : request.media.tmdbId
          }
          mbId={request.type === 'music' ? musicId : undefined}
          bookId={request.type === 'book' ? bookId : undefined}
          comicId={request.type === 'comic' ? comicId : undefined}
          type={
            request.type === 'music'
              ? 'music'
              : request.type === 'book'
                ? 'book'
                : request.type === 'comic'
                  ? 'comic'
                  : request.type === 'tv'
                    ? 'tv'
                    : 'movie'
          }
          is4k={request.is4k}
          editRequest={request}
          onCancel={() => setShowEditModal(false)}
          onComplete={() => {
            if (onUpdate) {
              onUpdate();
            }
            setShowEditModal(false);
          }}
        />
      )}
      <div className="px-4 py-3 text-gray-300">
        <div className="flex items-center justify-between">
          <div className="mr-6 min-w-0 flex-1 flex-col items-center text-sm leading-5">
            <div className="white mb-1 flex flex-nowrap">
              <span className="flex w-40 items-center truncate md:w-auto">
                <Tooltip content={intl.formatMessage(messages.requestedby)}>
                  <UserIcon className="mr-1.5 h-5 w-5 min-w-0 flex-shrink-0" />
                </Tooltip>
                <Link
                  href={
                    request.requestedBy.id === user?.id
                      ? '/profile'
                      : `/users/${request.requestedBy.id}`
                  }
                  className="flex items-center font-semibold text-gray-100 transition duration-300 hover:text-white hover:underline"
                >
                  <span className="avatar-sm">
                    <CachedImage
                      type="avatar"
                      src={request.requestedBy.avatar}
                      alt=""
                      className="avatar-sm object-cover"
                      width={20}
                      height={20}
                    />
                  </span>
                  {request.requestedBy.displayName}
                </Link>
              </span>
            </div>
            {request.modifiedBy && (
              <div className="flex flex-nowrap">
                <span className="flex w-40 items-center truncate md:w-auto">
                  <Tooltip
                    content={intl.formatMessage(messages.lastmodifiedby)}
                  >
                    <EyeIcon className="mr-1.5 h-5 w-5 flex-shrink-0" />
                  </Tooltip>
                  <Link
                    href={
                      request.modifiedBy.id === user?.id
                        ? '/profile'
                        : `/users/${request.modifiedBy.id}`
                    }
                    className="flex items-center font-semibold text-gray-100 transition duration-300 hover:text-white hover:underline"
                  >
                    <span className="avatar-sm">
                      <CachedImage
                        type="avatar"
                        src={request.modifiedBy.avatar}
                        alt=""
                        className="avatar-sm object-cover"
                        width={20}
                        height={20}
                      />
                    </span>
                    {request.modifiedBy.displayName}
                  </Link>
                </span>
              </div>
            )}
          </div>
          <div className="ml-2 flex flex-shrink-0 flex-wrap">
            {request.status === MediaRequestStatus.PENDING && (
              <>
                <Tooltip content={intl.formatMessage(messages.approve)}>
                  <Button
                    buttonType="success"
                    className="mr-1"
                    onClick={() => updateRequest('approve')}
                    disabled={isUpdating}
                  >
                    <CheckIcon className="icon-sm" />
                  </Button>
                </Tooltip>
                <Tooltip content={intl.formatMessage(messages.decline)}>
                  <Button
                    buttonType="danger"
                    className="mr-1"
                    onClick={() => updateRequest('decline')}
                    disabled={isUpdating}
                  >
                    <XMarkIcon />
                  </Button>
                </Tooltip>
                <Tooltip content={intl.formatMessage(messages.edit)}>
                  <Button
                    buttonType="warning"
                    onClick={() => setShowEditModal(true)}
                    disabled={isUpdating}
                  >
                    <PencilIcon className="icon-sm" />
                  </Button>
                </Tooltip>
              </>
            )}
            {request.status !== MediaRequestStatus.PENDING && (
              <Tooltip content={intl.formatMessage(messages.delete)}>
                <Button
                  buttonType="danger"
                  onClick={() => deleteRequest()}
                  disabled={isUpdating}
                >
                  <TrashIcon className="icon-sm" />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="mt-2 sm:flex sm:justify-between">
          <div className="sm:flex">
            <div className="mr-6 flex items-center text-sm leading-5">
              {request.type !== 'book' && (
                <span className="mr-1">
                  <MediaTypeBadge
                    mediaType={getMediaTypeBadgeType(request.type) ?? 'movie'}
                    variant="compact"
                  />
                </span>
              )}
              {request.is4k && (
                <span className="mr-1">
                  <Badge badgeType="warning">4K</Badge>
                </span>
              )}
              {request.type === 'book' && (
                <span className="mr-1">
                  <Tooltip content={intl.formatMessage(messages.bookFormat)}>
                    <BookFormatBadge
                      format={getRequestedBookFormat(request.bookFormat)}
                      variant="compact"
                    />
                  </Tooltip>
                </span>
              )}
              {request.status === MediaRequestStatus.APPROVED && (
                <Badge badgeType="success">
                  {intl.formatMessage(globalMessages.approved)}
                </Badge>
              )}
              {request.status === MediaRequestStatus.DECLINED && (
                <Badge badgeType="danger">
                  {intl.formatMessage(globalMessages.declined)}
                </Badge>
              )}
              {request.status === MediaRequestStatus.PENDING && (
                <Badge badgeType="warning">
                  {intl.formatMessage(globalMessages.pending)}
                </Badge>
              )}
              {request.status === MediaRequestStatus.FAILED && (
                <Badge badgeType="danger">
                  {intl.formatMessage(globalMessages.failed)}
                </Badge>
              )}
              {request.status === MediaRequestStatus.COMPLETED && (
                <Badge badgeType="success">
                  {intl.formatMessage(globalMessages.completed)}
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center text-sm leading-5 sm:mt-0">
            <Tooltip content={intl.formatMessage(messages.requestdate)}>
              <CalendarIcon className="mr-1.5 h-5 w-5 flex-shrink-0" />
            </Tooltip>
            <Tooltip
              content={intl.formatDate(request.createdAt, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
              })}
            >
              <span>
                {intl.formatDate(request.createdAt, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </Tooltip>
          </div>
        </div>
        {request.type === 'tv' && (request.seasons ?? []).length > 0 && (
          <div className="mt-2 flex flex-col text-sm">
            <div className="mb-1 font-medium">
              {intl.formatMessage(messages.seasons, {
                seasonCount: request.seasons.length,
              })}
            </div>
            <div>
              {request.seasons.map((season) => (
                <span
                  key={`season-${season.id}`}
                  className="mr-2 mb-1 inline-block"
                >
                  <Badge>
                    {season.seasonNumber === 0
                      ? intl.formatMessage(globalMessages.specials)
                      : season.seasonNumber}
                  </Badge>
                </span>
              ))}
            </div>
          </div>
        )}
        {(server ||
          profile ||
          metadataProfile ||
          rootFolder ||
          languageProfile) && (
          <>
            <div className="mt-4 mb-1 text-sm">
              {intl.formatMessage(messages.requestoverrides)}
            </div>
            <ul className="divide-y divide-gray-700 rounded-md bg-gray-800 px-2 text-xs">
              {server && (
                <li className="flex justify-between px-1 py-2">
                  <span className="font-bold">
                    {intl.formatMessage(messages.server)}
                  </span>
                  <span>{server}</span>
                </li>
              )}
              {profile && (
                <li className="flex justify-between px-1 py-2">
                  <span className="font-bold">
                    {intl.formatMessage(messages.profilechanged)}
                  </span>
                  <span>{profile}</span>
                </li>
              )}
              {metadataProfile && (
                <li className="flex justify-between px-1 py-2">
                  <span className="font-bold">
                    {intl.formatMessage(messages.metadataprofilechanged)}
                  </span>
                  <span>{metadataProfile}</span>
                </li>
              )}
              {rootFolder && (
                <li className="flex justify-between px-1 py-2">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.rootfolder)}
                  </span>
                  <span>{rootFolder}</span>
                </li>
              )}
              {languageProfile && (
                <li className="flex justify-between px-1 py-2">
                  <span className="mr-2 font-bold">
                    {intl.formatMessage(messages.languageprofile)}
                  </span>
                  <span>{languageProfile}</span>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

export default RequestBlock;
