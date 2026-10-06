import LidarrLogo from '@app/assets/services/lidarr.svg';
import RadarrLogo from '@app/assets/services/radarr.svg';
import SonarrLogo from '@app/assets/services/sonarr.svg';
import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import OverrideRuleTiles from '@app/components/Settings/OverrideRule/OverrideRuleTiles';
import ReaderDeliverySettings from '@app/components/Settings/ReaderDeliverySettings';
import SettingsDownloadClients from '@app/components/Settings/SettingsDownloadClients';
import { useSettingsPageAction } from '@app/components/Settings/SettingsLayout';
import SettingsProwlarr from '@app/components/Settings/SettingsProwlarr';
import SettingsSoftwareAcquisition from '@app/components/Settings/SettingsSoftwareAcquisition';
import SettingsTunerr from '@app/components/Settings/SettingsTunerr';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import { Transition } from '@headlessui/react';
import {
  BookOpenIcon,
  MusicalNoteIcon,
  NewspaperIcon,
  PencilIcon,
  PlusIcon,
  Square3Stack3DIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type OverrideRule from '@server/entity/OverrideRule';
import type { OverrideRuleResultsResponse } from '@server/interfaces/api/overrideRuleInterfaces';
import type {
  AudiobookshelfSettings,
  BackIssueSettings,
  KapowarrSettings,
  LazyLibrarianSettings,
  LidarrSettings,
  MylarSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { Fragment, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const KapowarrModal = dynamic(
  () => import('@app/components/Settings/KapowarrModal')
);
const BackIssueModal = dynamic(
  () => import('@app/components/Settings/BackIssueModal')
);
const AudiobookshelfModal = dynamic(
  () => import('@app/components/Settings/AudiobookshelfModal')
);
const LazyLibrarianModal = dynamic(
  () => import('@app/components/Settings/LazyLibrarianModal')
);
const LidarrModal = dynamic(
  () => import('@app/components/Settings/LidarrModal')
);
const MylarModal = dynamic(() => import('@app/components/Settings/MylarModal'));
const OverrideRuleModal = dynamic(
  () => import('@app/components/Settings/OverrideRule/OverrideRuleModal')
);
const RadarrModal = dynamic(
  () => import('@app/components/Settings/RadarrModal')
);
const ReadarrModal = dynamic(
  () => import('@app/components/Settings/ReadarrModal')
);
const SonarrModal = dynamic(
  () => import('@app/components/Settings/SonarrModal')
);

const messages = defineMessages('components.Settings', {
  services: 'Services',
  radarrsettings: 'Radarr Settings',
  sonarrsettings: 'Sonarr Settings',
  lidarrsettings: 'Lidarr Settings',
  readarrsettings: 'Bookshelf Settings',
  audiobookshelfsettings: 'Audiobookshelf Availability',
  audiobookshelfDescription:
    'Optionally sync an Audiobookshelf book library so SeerrNG can recognize matching audiobooks that are already available. This connection is read-only and does not send acquisition requests.',
  addAudiobookshelf: 'Connect Audiobookshelf library',
  videoServiceSettingsDescription:
    'Configure your {serverType} server(s) below. You can connect multiple {serverType} servers, but only two of them can be marked as defaults (one non-4K and one 4K). Administrators are able to override the server used to process new requests prior to approval.',
  musicServiceSettingsDescription:
    'Configure your {serverType} server(s) below. You can connect multiple {serverType} servers, but only one of them can be marked as default. Administrators are able to override the server used to process new requests prior to approval.',
  bookServiceSettingsDescription:
    'Add one connection for Books and one for Audiobooks to enable both request formats. Both connections can point to the same {serverType} instance; select a different Book Format on each and mark one default for each format. Administrators can override the server before approval.',
  bookFreshSetup:
    'Recommended for a new setup: run one BookshelfNG instance for both formats. Add the Book connection first, then use the same instance for Audiobooks.',
  bookAddMissingFormat:
    'This Bookshelf can handle both formats. Add the missing {format} connection using the same instance, or add a different server.',
  bookAddOtherFormat: 'Use this instance for {format} requests',
  bookSharedSetup:
    'These two SeerrNG connections route requests to one BookshelfNG instance and share its library.',
  bookSplitUpgrade:
    'Your Book and Audiobook connections use different addresses. Upgrades keep them as configured. If they use separate databases, migrate the audiobook library before pointing both connections to one BookshelfNG instance.',
  bookCombineGuide: 'Bookshelf deployment options',
  deleteserverconfirm: 'Are you sure you want to delete this server?',
  ssl: 'SSL',
  default: 'Default',
  default4k: 'Default 4K',
  is4k: '4K',
  ebook: 'Book',
  audiobook: 'Audiobook',
  address: 'Address',
  activeProfile: 'Active Profile',
  addradarr: 'Add Radarr Server',
  addsonarr: 'Add Sonarr Server',
  addlidarr: 'Add Lidarr Server',
  addreadarr: 'Add Bookshelf Server',
  addmylar: 'Add Mylar Server',
  addkapowarr: 'Add Kapowarr Server',
  addbackissue: 'Add BackIssue Server',
  addlazylibrarian: 'Add LazyLibrarian Server',
  lazylibrariansettings: 'LazyLibrarian Settings',
  magazineServiceSettingsDescription:
    'Configure LazyLibrarian to search and track magazine issues. Enable scanning to keep library availability current.',
  mediaTypeMagazine: 'magazine',
  mylarsettings: 'Mylar Settings',
  kapowarrsettings: 'Kapowarr Settings',
  backissuesettings: 'BackIssue Settings',
  comicServiceSettingsDescription:
    'Configure your {serverType} server(s) below. Mylar, Kapowarr, and BackIssue share one default: choose one comics destination for requests without a server selection.',
  mediaTypeComic: 'comic',
  noDefaultServer:
    'At least one {serverType} server must be marked as default in order for {mediaType} requests to be processed.',
  noDefaultNon4kServer:
    'If you only have a single {serverType} server for both non-4K and 4K content (or if you only download 4K content), your {serverType} server should <strong>NOT</strong> be designated as a 4K server.',
  noDefault4kServer:
    'A 4K {serverType} server must be marked as default in order to enable users to submit 4K {mediaType} requests.',
  mediaTypeMovie: 'movie',
  mediaTypeSeries: 'series',
  mediaTypeMusic: 'music',
  mediaTypeBook: 'book',
  mediaTypeEbook: 'book',
  mediaTypeAudiobook: 'audiobook',
  deleteServer: 'Delete {serverType} Server',
  overrideRules: 'Override Rules',
  overrideRulesDescription:
    'Override rules allow you to specify properties that will be replaced if a request matches the rule.',
  addrule: 'New Override Rule',
});

interface ServerInstanceProps {
  name: string;
  isDefault?: boolean;
  is4k?: boolean;
  hostname: string;
  port: number;
  isSSL?: boolean;
  externalUrl?: string;
  profileName?: string;
  isSonarr?: boolean;
  isLidarr?: boolean;
  isReadarr?: boolean;
  isAudiobookshelf?: boolean;
  isComics?: boolean;
  isMagazines?: boolean;
  serviceFormat?: 'ebook' | 'audiobook';
  onEdit: () => void;
  onDelete: () => void;
}

export interface DVRTestResponse {
  profiles: {
    id: number;
    name: string;
  }[];
  rootFolders: {
    id: number;
    path: string;
  }[];
  tags: {
    id: number;
    label: string;
  }[];
  urlBase?: string;
}

export type RadarrTestResponse = DVRTestResponse;

export type SonarrTestResponse = DVRTestResponse & {
  languageProfiles:
    | {
        id: number;
        name: string;
      }[]
    | null;
};

const ServerInstance = ({
  name,
  hostname,
  port,
  profileName,
  is4k = false,
  isDefault = false,
  isSSL = false,
  isSonarr = false,
  isLidarr = false,
  isReadarr = false,
  isAudiobookshelf = false,
  isComics = false,
  isMagazines = false,
  serviceFormat,
  externalUrl,
  onEdit,
  onDelete,
}: ServerInstanceProps) => {
  const intl = useIntl();

  const internalUrl =
    (isSSL ? 'https://' : 'http://') + hostname + ':' + String(port);
  const internalHref = getSafeHref(internalUrl);
  const serviceUrl = getSafeHref(externalUrl) ?? internalHref;

  return (
    <li className="settings-service-card app-card-inset refreshed-inset-surface">
      <div className="settings-service-card-content">
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="settings-service-logo-link"
        >
          {isSonarr ? (
            <SonarrLogo className="h-10 w-10 flex-shrink-0" />
          ) : isLidarr ? (
            <LidarrLogo className="h-10 w-10 flex-shrink-0" />
          ) : isReadarr ? (
            <BookOpenIcon className="h-10 w-10 flex-shrink-0 text-gray-300" />
          ) : isAudiobookshelf ? (
            <MusicalNoteIcon className="h-10 w-10 flex-shrink-0 text-gray-300" />
          ) : isComics ? (
            <Square3Stack3DIcon className="h-10 w-10 flex-shrink-0 text-gray-300" />
          ) : isMagazines ? (
            <NewspaperIcon className="h-10 w-10 flex-shrink-0 text-gray-300" />
          ) : (
            <RadarrLogo className="h-10 w-10 flex-shrink-0" />
          )}
        </a>
        <div className="settings-service-card-body">
          <h3 className="settings-service-title">
            <a
              href={serviceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition duration-300 hover:text-white hover:underline"
            >
              {name}
            </a>
          </h3>
          <div className="settings-service-badges">
            {isDefault && !is4k && (
              <Badge>{intl.formatMessage(messages.default)}</Badge>
            )}
            {isDefault && is4k && (
              <Badge>{intl.formatMessage(messages.default4k)}</Badge>
            )}
            {!isDefault && is4k && (
              <Badge badgeType="warning">
                {intl.formatMessage(messages.is4k)}
              </Badge>
            )}
            {isReadarr && serviceFormat && (
              <Badge
                badgeType={
                  serviceFormat === 'audiobook' ? 'warning' : 'default'
                }
              >
                {intl.formatMessage(
                  serviceFormat === 'audiobook'
                    ? messages.audiobook
                    : messages.ebook
                )}
              </Badge>
            )}
            {isAudiobookshelf && (
              <Badge badgeType="warning">
                {intl.formatMessage(messages.audiobook)}
              </Badge>
            )}
            {isSSL && (
              <Badge badgeType="success">
                {intl.formatMessage(messages.ssl)}
              </Badge>
            )}
          </div>
          <dl className="settings-service-details">
            <dt>{intl.formatMessage(messages.address)}</dt>
            <dd>
              <a
                href={internalHref}
                target="_blank"
                rel="noopener noreferrer"
                className="transition duration-300 hover:text-white hover:underline"
              >
                {internalUrl}
              </a>
            </dd>
            {profileName !== undefined && (
              <>
                <dt>{intl.formatMessage(messages.activeProfile)}</dt>
                <dd>{profileName}</dd>
              </>
            )}
          </dl>
          <div className="settings-card-actions settings-service-card-actions">
            <Button
              buttonType="warning"
              buttonSize="standard"
              onClick={() => onEdit()}
            >
              <PencilIcon />
              <span>{intl.formatMessage(globalMessages.edit)}</span>
            </Button>
            <Button
              buttonType="danger"
              buttonSize="standard"
              className="settings-service-delete-action"
              onClick={() => onDelete()}
            >
              <TrashIcon />
              <span>{intl.formatMessage(globalMessages.delete)}</span>
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
};

const SettingsServices = () => {
  const intl = useIntl();
  const {
    data: radarrData,
    error: radarrError,
    mutate: revalidateRadarr,
  } = useSWR<RadarrSettings[]>('/api/v1/settings/radarr');
  const {
    data: sonarrData,
    error: sonarrError,
    mutate: revalidateSonarr,
  } = useSWR<SonarrSettings[]>('/api/v1/settings/sonarr');
  const {
    data: lidarrData,
    error: lidarrError,
    mutate: revalidateLidarr,
  } = useSWR<LidarrSettings[]>('/api/v1/settings/lidarr');
  const {
    data: readarrData,
    error: readarrError,
    mutate: revalidateReadarr,
  } = useSWR<ReadarrSettings[]>('/api/v1/settings/readarr');
  const { data: audiobookshelfData, mutate: revalidateAudiobookshelf } =
    useSWR<AudiobookshelfSettings | null>('/api/v1/settings/audiobookshelf');
  const {
    data: mylarData,
    error: mylarError,
    mutate: revalidateMylar,
  } = useSWR<MylarSettings[]>('/api/v1/settings/mylar');
  const {
    data: kapowarrData,
    error: kapowarrError,
    mutate: revalidateKapowarr,
  } = useSWR<KapowarrSettings[]>('/api/v1/settings/kapowarr');
  const {
    data: backissueData,
    error: backissueError,
    mutate: revalidateBackIssue,
  } = useSWR<BackIssueSettings[]>('/api/v1/settings/backissue');
  const {
    data: lazyLibrarianData,
    error: lazyLibrarianError,
    mutate: revalidateLazyLibrarian,
  } = useSWR<LazyLibrarianSettings[]>('/api/v1/settings/lazylibrarian');
  const { data: rules, mutate: revalidate } =
    useSWR<OverrideRuleResultsResponse>('/api/v1/overrideRule');
  const [editRadarrModal, setEditRadarrModal] = useState<{
    open: boolean;
    radarr: RadarrSettings | null;
  }>({
    open: false,
    radarr: null,
  });
  const [editSonarrModal, setEditSonarrModal] = useState<{
    open: boolean;
    sonarr: SonarrSettings | null;
  }>({
    open: false,
    sonarr: null,
  });
  const [editLidarrModal, setEditLidarrModal] = useState<{
    open: boolean;
    lidarr: LidarrSettings | null;
  }>({
    open: false,
    lidarr: null,
  });
  const [editReadarrModal, setEditReadarrModal] = useState<{
    open: boolean;
    readarr: ReadarrSettings | null;
    copyFrom?: ReadarrSettings | null;
    copyFormat?: 'ebook' | 'audiobook';
  }>({
    open: false,
    readarr: null,
  });
  const [editAudiobookshelfModal, setEditAudiobookshelfModal] = useState(false);
  const [editMylarModal, setEditMylarModal] = useState<{
    open: boolean;
    mylar: MylarSettings | null;
  }>({
    open: false,
    mylar: null,
  });
  const [editKapowarrModal, setEditKapowarrModal] = useState<{
    open: boolean;
    kapowarr: KapowarrSettings | null;
  }>({
    open: false,
    kapowarr: null,
  });
  const [editBackIssueModal, setEditBackIssueModal] = useState<{
    open: boolean;
    backissue: BackIssueSettings | null;
  }>({ open: false, backissue: null });
  const [editLazyLibrarianModal, setEditLazyLibrarianModal] = useState<{
    open: boolean;
    lazylibrarian: LazyLibrarianSettings | null;
  }>({
    open: false,
    lazylibrarian: null,
  });
  const [deleteServerModal, setDeleteServerModal] = useState<{
    open: boolean;
    type:
      | 'radarr'
      | 'sonarr'
      | 'lidarr'
      | 'readarr'
      | 'audiobookshelf'
      | 'mylar'
      | 'kapowarr'
      | 'backissue'
      | 'lazylibrarian';
    serverId: number | null;
  }>({
    open: false,
    type: 'radarr',
    serverId: null,
  });
  const [overrideRuleModal, setOverrideRuleModal] = useState<{
    open: boolean;
    rule: OverrideRule | null;
  }>({
    open: false,
    rule: null,
  });
  const newOverrideRuleAction = useMemo(
    () => ({
      label: intl.formatMessage(messages.addrule),
      icon: <PlusIcon />,
      disabled:
        !radarrData?.length && !sonarrData?.length && !lidarrData?.length,
      onClick: () =>
        setOverrideRuleModal({
          open: true,
          rule: null,
        }),
    }),
    [intl, lidarrData?.length, radarrData?.length, sonarrData?.length]
  );
  useSettingsPageAction(newOverrideRuleAction);
  const hasReadarrEbook = readarrData?.some(
    (readarr) => (readarr.serviceType ?? 'ebook') === 'ebook'
  );
  const hasDefaultReadarrEbook = readarrData?.some(
    (readarr) =>
      (readarr.serviceType ?? 'ebook') === 'ebook' && readarr.isDefault
  );
  const hasReadarrAudiobook = readarrData?.some(
    (readarr) => readarr.serviceType === 'audiobook'
  );
  const hasDefaultReadarrAudiobook = readarrData?.some(
    (readarr) => readarr.serviceType === 'audiobook' && readarr.isDefault
  );
  const missingBookFormat =
    hasReadarrEbook && !hasReadarrAudiobook
      ? 'audiobook'
      : hasReadarrAudiobook && !hasReadarrEbook
        ? 'ebook'
        : undefined;
  const bookConnectionToCopy =
    readarrData?.find((readarr) => readarr.isDefault) ?? readarrData?.[0];
  const ebookConnections =
    readarrData?.filter(
      (readarr) => (readarr.serviceType ?? 'ebook') === 'ebook'
    ) ?? [];
  const audiobookConnections =
    readarrData?.filter((readarr) => readarr.serviceType === 'audiobook') ?? [];
  const hasSharedBookshelf = ebookConnections.some((ebook) =>
    audiobookConnections.some(
      (audiobook) =>
        ebook.hostname.trim().toLowerCase() ===
          audiobook.hostname.trim().toLowerCase() &&
        ebook.port === audiobook.port &&
        ebook.useSsl === audiobook.useSsl &&
        (ebook.baseUrl ?? '') === (audiobook.baseUrl ?? '')
    )
  );

  const deleteServer = async () => {
    if (deleteServerModal.type === 'audiobookshelf') {
      await axios.delete('/api/v1/settings/audiobookshelf');
    } else {
      await axios.delete(
        `/api/v1/settings/${deleteServerModal.type}/${deleteServerModal.serverId}`
      );
    }
    setDeleteServerModal({ open: false, serverId: null, type: 'radarr' });
    revalidateRadarr();
    revalidateSonarr();
    revalidateLidarr();
    revalidateReadarr();
    revalidateMylar();
    revalidateKapowarr();
    revalidateBackIssue();
    revalidateLazyLibrarian();
    revalidateAudiobookshelf();
    mutate('/api/v1/settings/public');
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.services),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.radarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.videoServiceSettingsDescription, {
            serverType: 'Radarr',
          })}
        </p>
      </div>
      {editRadarrModal.open && (
        <RadarrModal
          radarr={editRadarrModal.radarr}
          onClose={() => {
            if (!overrideRuleModal.open)
              setEditRadarrModal({ open: false, radarr: null });
          }}
          onSave={() => {
            revalidateRadarr();
            mutate('/api/v1/settings/public');
            setEditRadarrModal({ open: false, radarr: null });
          }}
        />
      )}
      {editSonarrModal.open && (
        <SonarrModal
          sonarr={editSonarrModal.sonarr}
          onClose={() => {
            if (!overrideRuleModal.open)
              setEditSonarrModal({ open: false, sonarr: null });
          }}
          onSave={() => {
            revalidateSonarr();
            mutate('/api/v1/settings/public');
            setEditSonarrModal({ open: false, sonarr: null });
          }}
        />
      )}
      {editLidarrModal.open && (
        <LidarrModal
          lidarr={editLidarrModal.lidarr}
          onClose={() => setEditLidarrModal({ open: false, lidarr: null })}
          onSave={() => {
            revalidateLidarr();
            mutate('/api/v1/settings/public');
            setEditLidarrModal({ open: false, lidarr: null });
          }}
        />
      )}
      {editReadarrModal.open && (
        <ReadarrModal
          readarr={editReadarrModal.readarr}
          copyFrom={editReadarrModal.copyFrom}
          copyFormat={editReadarrModal.copyFormat}
          onClose={() => setEditReadarrModal({ open: false, readarr: null })}
          onSave={() => {
            revalidateReadarr();
            mutate('/api/v1/settings/public');
            setEditReadarrModal({ open: false, readarr: null });
          }}
        />
      )}
      {editAudiobookshelfModal && (
        <AudiobookshelfModal
          settings={audiobookshelfData ?? null}
          onClose={() => setEditAudiobookshelfModal(false)}
          onSave={() => {
            revalidateAudiobookshelf();
            mutate('/api/v1/settings/public');
            setEditAudiobookshelfModal(false);
          }}
        />
      )}
      {editMylarModal.open && (
        <MylarModal
          mylar={editMylarModal.mylar}
          onClose={() => setEditMylarModal({ open: false, mylar: null })}
          onSave={() => {
            revalidateMylar();
            revalidateKapowarr();
            revalidateBackIssue();
            mutate('/api/v1/settings/public');
            setEditMylarModal({ open: false, mylar: null });
          }}
        />
      )}
      {editKapowarrModal.open && (
        <KapowarrModal
          kapowarr={editKapowarrModal.kapowarr}
          onClose={() => setEditKapowarrModal({ open: false, kapowarr: null })}
          onSave={() => {
            revalidateKapowarr();
            revalidateMylar();
            revalidateBackIssue();
            mutate('/api/v1/settings/public');
            setEditKapowarrModal({ open: false, kapowarr: null });
          }}
        />
      )}
      {editBackIssueModal.open && (
        <BackIssueModal
          backissue={editBackIssueModal.backissue}
          onClose={() =>
            setEditBackIssueModal({ open: false, backissue: null })
          }
          onSave={() => {
            revalidateBackIssue();
            revalidateMylar();
            revalidateKapowarr();
            mutate('/api/v1/settings/public');
            setEditBackIssueModal({ open: false, backissue: null });
          }}
        />
      )}
      {editLazyLibrarianModal.open && (
        <LazyLibrarianModal
          lazylibrarian={editLazyLibrarianModal.lazylibrarian}
          onClose={() =>
            setEditLazyLibrarianModal({ open: false, lazylibrarian: null })
          }
          onSave={() => {
            revalidateLazyLibrarian();
            mutate('/api/v1/settings/public');
            setEditLazyLibrarianModal({ open: false, lazylibrarian: null });
          }}
        />
      )}
      <Transition as={Fragment} show={deleteServerModal.open}>
        <Modal
          okText={intl.formatMessage(globalMessages.delete)}
          okButtonType="danger"
          okButtonProps={{ buttonIcon: 'delete' }}
          onOk={() => deleteServer()}
          onCancel={() =>
            setDeleteServerModal({
              open: false,
              serverId: null,
              type: 'radarr',
            })
          }
          title={intl.formatMessage(messages.deleteServer, {
            serverType:
              deleteServerModal.type === 'radarr'
                ? 'Radarr'
                : deleteServerModal.type === 'sonarr'
                  ? 'Sonarr'
                  : deleteServerModal.type === 'lidarr'
                    ? 'Lidarr'
                    : deleteServerModal.type === 'backissue'
                      ? 'BackIssue'
                      : deleteServerModal.type === 'audiobookshelf'
                        ? 'Audiobookshelf'
                        : 'Bookshelf',
          })}
        >
          {intl.formatMessage(messages.deleteserverconfirm)}
        </Modal>
      </Transition>
      <div className="app-card-sub section settings-service-section">
        {!radarrData && !radarrError && <LoadingSpinner />}
        {radarrData && !radarrError && (
          <>
            {radarrData.length > 0 &&
              (!radarrData.some((radarr) => radarr.isDefault) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Radarr',
                    mediaType: intl.formatMessage(messages.mediaTypeMovie),
                  })}
                />
              ) : !radarrData.some(
                  (radarr) => radarr.isDefault && !radarr.is4k
                ) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultNon4kServer, {
                    serverType: 'Radarr',
                    strong: (msg: React.ReactNode) => (
                      <strong className="font-semibold text-white">
                        {msg}
                      </strong>
                    ),
                  })}
                />
              ) : (
                radarrData.some((radarr) => radarr.is4k) &&
                !radarrData.some(
                  (radarr) => radarr.isDefault && radarr.is4k
                ) && (
                  <Alert
                    title={intl.formatMessage(messages.noDefault4kServer, {
                      serverType: 'Radarr',
                      mediaType: intl.formatMessage(messages.mediaTypeMovie),
                    })}
                  />
                )
              ))}
            <ul className="settings-service-grid">
              {radarrData.map((radarr) => (
                <ServerInstance
                  key={`radarr-config-${radarr.id}`}
                  name={radarr.name}
                  hostname={radarr.hostname}
                  port={radarr.port}
                  profileName={radarr.activeProfileName}
                  isSSL={radarr.useSsl}
                  isDefault={radarr.isDefault}
                  is4k={radarr.is4k}
                  externalUrl={radarr.externalUrl}
                  onEdit={() => setEditRadarrModal({ open: true, radarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: radarr.id,
                      type: 'radarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    className="mt-3 mb-3"
                    onClick={() =>
                      setEditRadarrModal({ open: true, radarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addradarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.sonarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.videoServiceSettingsDescription, {
            serverType: 'Sonarr',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!sonarrData && !sonarrError && <LoadingSpinner />}
        {sonarrData && !sonarrError && (
          <>
            {sonarrData.length > 0 &&
              (!sonarrData.some((sonarr) => sonarr.isDefault) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Sonarr',
                    mediaType: intl.formatMessage(messages.mediaTypeSeries),
                  })}
                />
              ) : !sonarrData.some(
                  (sonarr) => sonarr.isDefault && !sonarr.is4k
                ) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultNon4kServer, {
                    serverType: 'Sonarr',
                    strong: (msg: React.ReactNode) => (
                      <strong className="font-semibold text-white">
                        {msg}
                      </strong>
                    ),
                  })}
                />
              ) : (
                sonarrData.some((sonarr) => sonarr.is4k) &&
                !sonarrData.some(
                  (sonarr) => sonarr.isDefault && sonarr.is4k
                ) && (
                  <Alert
                    title={intl.formatMessage(messages.noDefault4kServer, {
                      serverType: 'Sonarr',
                      mediaType: intl.formatMessage(messages.mediaTypeSeries),
                    })}
                  />
                )
              ))}
            <ul className="settings-service-grid">
              {sonarrData.map((sonarr) => (
                <ServerInstance
                  key={`sonarr-config-${sonarr.id}`}
                  name={sonarr.name}
                  hostname={sonarr.hostname}
                  port={sonarr.port}
                  profileName={sonarr.activeProfileName}
                  isSSL={sonarr.useSsl}
                  isSonarr
                  isDefault={sonarr.isDefault}
                  is4k={sonarr.is4k}
                  externalUrl={sonarr.externalUrl}
                  onEdit={() => setEditSonarrModal({ open: true, sonarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: sonarr.id,
                      type: 'sonarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditSonarrModal({ open: true, sonarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addsonarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.lidarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.musicServiceSettingsDescription, {
            serverType: 'Lidarr',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!lidarrData && !lidarrError && <LoadingSpinner />}
        {lidarrData && !lidarrError && (
          <>
            {lidarrData.length > 0 &&
              (!lidarrData.some((lidarr) => lidarr.isDefault) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Lidarr',
                    mediaType: intl.formatMessage(messages.mediaTypeMusic),
                  })}
                />
              ) : null)}
            <ul className="settings-service-grid">
              {lidarrData.map((lidarr) => (
                <ServerInstance
                  key={`lidarr-config-${lidarr.id}`}
                  name={lidarr.name}
                  hostname={lidarr.hostname}
                  port={lidarr.port}
                  profileName={lidarr.activeProfileName}
                  isSSL={lidarr.useSsl}
                  isLidarr={true}
                  isDefault={lidarr.isDefault}
                  externalUrl={lidarr.externalUrl}
                  onEdit={() => setEditLidarrModal({ open: true, lidarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: lidarr.id,
                      type: 'lidarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditLidarrModal({ open: true, lidarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addlidarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.readarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.bookServiceSettingsDescription, {
            serverType: 'Bookshelf',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!readarrData && !readarrError && <LoadingSpinner />}
        {readarrData && !readarrError && (
          <>
            {readarrData.length === 0 && (
              <p className="mb-4 text-sm text-gray-300">
                {intl.formatMessage(messages.bookFreshSetup)}
              </p>
            )}
            {missingBookFormat && bookConnectionToCopy && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-gray-300">
                  {intl.formatMessage(messages.bookAddMissingFormat, {
                    format: intl.formatMessage(
                      missingBookFormat === 'ebook'
                        ? messages.ebook
                        : messages.audiobook
                    ),
                  })}
                </p>
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={() =>
                    setEditReadarrModal({
                      open: true,
                      readarr: null,
                      copyFrom: bookConnectionToCopy,
                      copyFormat: missingBookFormat,
                    })
                  }
                >
                  {intl.formatMessage(messages.bookAddOtherFormat, {
                    format: intl.formatMessage(
                      missingBookFormat === 'ebook'
                        ? messages.ebook
                        : messages.audiobook
                    ),
                  })}
                </Button>
              </div>
            )}
            {hasReadarrEbook && hasReadarrAudiobook && (
              <p className="mb-4 text-sm text-gray-300">
                {intl.formatMessage(
                  hasSharedBookshelf
                    ? messages.bookSharedSetup
                    : messages.bookSplitUpgrade
                )}{' '}
                {!hasSharedBookshelf && (
                  <a
                    className="text-primary-400 hover:underline"
                    href="https://github.com/snapetech/seerrng/blob/main/docs/using-seerr/bookshelf-backend.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {intl.formatMessage(messages.bookCombineGuide)}
                  </a>
                )}
              </p>
            )}
            {readarrData.length > 0 && (
              <>
                {hasReadarrEbook && !hasDefaultReadarrEbook && (
                  <Alert
                    title={intl.formatMessage(messages.noDefaultServer, {
                      serverType: 'Bookshelf',
                      mediaType: intl.formatMessage(messages.mediaTypeEbook),
                    })}
                  />
                )}
                {hasReadarrAudiobook && !hasDefaultReadarrAudiobook && (
                  <Alert
                    title={intl.formatMessage(messages.noDefaultServer, {
                      serverType: 'Bookshelf',
                      mediaType: intl.formatMessage(
                        messages.mediaTypeAudiobook
                      ),
                    })}
                  />
                )}
                {!hasReadarrEbook && !hasReadarrAudiobook && (
                  <Alert
                    title={intl.formatMessage(messages.noDefaultServer, {
                      serverType: 'Bookshelf',
                      mediaType: intl.formatMessage(messages.mediaTypeBook),
                    })}
                  />
                )}
              </>
            )}
            <ul className="settings-service-grid">
              {readarrData.map((readarr) => (
                <ServerInstance
                  key={`readarr-config-${readarr.id}`}
                  name={readarr.name}
                  hostname={readarr.hostname}
                  port={readarr.port}
                  profileName={readarr.activeProfileName}
                  isSSL={readarr.useSsl}
                  isReadarr={true}
                  serviceFormat={readarr.serviceType ?? 'ebook'}
                  isDefault={readarr.isDefault}
                  externalUrl={readarr.externalUrl}
                  onEdit={() => setEditReadarrModal({ open: true, readarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: readarr.id,
                      type: 'readarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditReadarrModal({ open: true, readarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addreadarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
            <div className="mt-8 mb-4">
              <h4 className="text-lg font-semibold">
                {intl.formatMessage(messages.audiobookshelfsettings)}
              </h4>
              <p className="description">
                {intl.formatMessage(messages.audiobookshelfDescription)}
              </p>
            </div>
            <ul className="settings-service-grid">
              {audiobookshelfData && (
                <ServerInstance
                  name={`${audiobookshelfData.name} · ${audiobookshelfData.libraryName}`}
                  hostname={audiobookshelfData.hostname}
                  port={audiobookshelfData.port}
                  isSSL={audiobookshelfData.useSsl}
                  isAudiobookshelf
                  externalUrl={audiobookshelfData.externalUrl}
                  onEdit={() => setEditAudiobookshelfModal(true)}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: audiobookshelfData.id,
                      type: 'audiobookshelf',
                    })
                  }
                />
              )}
              {!audiobookshelfData && (
                <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                  <div className="flex h-full w-full items-center justify-center">
                    <Button
                      buttonType="success"
                      buttonSize="standard"
                      onClick={() => setEditAudiobookshelfModal(true)}
                    >
                      <PlusIcon />
                      <span>
                        {intl.formatMessage(messages.addAudiobookshelf)}
                      </span>
                    </Button>
                  </div>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.mylarsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.comicServiceSettingsDescription, {
            serverType: 'Mylar',
          })}
        </p>
      </div>
      {mylarData &&
        kapowarrData &&
        backissueData &&
        mylarData.length + kapowarrData.length + backissueData.length > 0 &&
        !mylarData.some((mylar) => mylar.isDefault) &&
        !kapowarrData.some((kapowarr) => kapowarr.isDefault) &&
        !backissueData.some((backissue) => backissue.isDefault) && (
          <Alert
            title={intl.formatMessage(messages.noDefaultServer, {
              serverType: 'Mylar, Kapowarr, or BackIssue',
              mediaType: intl.formatMessage(messages.mediaTypeComic),
            })}
          />
        )}
      <div className="app-card-sub section settings-service-section">
        {!mylarData && !mylarError && <LoadingSpinner />}
        {mylarData && !mylarError && (
          <>
            <ul className="settings-service-grid">
              {mylarData.map((mylar) => (
                <ServerInstance
                  key={`mylar-config-${mylar.id}`}
                  name={mylar.name}
                  hostname={mylar.hostname}
                  port={mylar.port}
                  profileName={mylar.rootFolder ?? ''}
                  isSSL={mylar.useSsl}
                  isComics={true}
                  isDefault={mylar.isDefault}
                  externalUrl={mylar.externalUrl}
                  onEdit={() => setEditMylarModal({ open: true, mylar })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: mylar.id,
                      type: 'mylar',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditMylarModal({ open: true, mylar: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addmylar)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.kapowarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.comicServiceSettingsDescription, {
            serverType: 'Kapowarr',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!kapowarrData && !kapowarrError && <LoadingSpinner />}
        {kapowarrData && !kapowarrError && (
          <>
            <ul className="settings-service-grid">
              {kapowarrData.map((kapowarr) => (
                <ServerInstance
                  key={`kapowarr-config-${kapowarr.id}`}
                  name={kapowarr.name}
                  hostname={kapowarr.hostname}
                  port={kapowarr.port}
                  profileName={kapowarr.rootFolder ?? ''}
                  isSSL={kapowarr.useSsl}
                  isComics={true}
                  isDefault={kapowarr.isDefault}
                  externalUrl={kapowarr.externalUrl}
                  onEdit={() => setEditKapowarrModal({ open: true, kapowarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: kapowarr.id,
                      type: 'kapowarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditKapowarrModal({ open: true, kapowarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addkapowarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.backissuesettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.comicServiceSettingsDescription, {
            serverType: 'BackIssue',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!backissueData && !backissueError && <LoadingSpinner />}
        {backissueData && !backissueError && (
          <ul className="settings-service-grid">
            {backissueData.map((backissue) => (
              <ServerInstance
                key={`backissue-config-${backissue.id}`}
                name={backissue.name}
                hostname={backissue.hostname}
                port={backissue.port}
                isSSL={backissue.useSsl}
                isComics={true}
                isDefault={backissue.isDefault}
                externalUrl={backissue.externalUrl}
                onEdit={() => setEditBackIssueModal({ open: true, backissue })}
                onDelete={() =>
                  setDeleteServerModal({
                    open: true,
                    serverId: backissue.id,
                    type: 'backissue',
                  })
                }
              />
            ))}
            <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
              <div className="flex h-full w-full items-center justify-center">
                <Button
                  buttonType="success"
                  buttonSize="standard"
                  onClick={() =>
                    setEditBackIssueModal({ open: true, backissue: null })
                  }
                >
                  <PlusIcon />
                  <span>{intl.formatMessage(messages.addbackissue)}</span>
                </Button>
              </div>
            </li>
          </ul>
        )}
      </div>
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.lazylibrariansettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.magazineServiceSettingsDescription)}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        {!lazyLibrarianData && !lazyLibrarianError && <LoadingSpinner />}
        {lazyLibrarianData && !lazyLibrarianError && (
          <>
            {lazyLibrarianData.length > 0 &&
              !lazyLibrarianData.some(({ isDefault }) => isDefault) && (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'LazyLibrarian',
                    mediaType: intl.formatMessage(messages.mediaTypeMagazine),
                  })}
                />
              )}
            <ul className="settings-service-grid">
              {lazyLibrarianData.map((lazylibrarian) => (
                <ServerInstance
                  key={`lazylibrarian-config-${lazylibrarian.id}`}
                  name={lazylibrarian.name}
                  hostname={lazylibrarian.hostname}
                  port={lazylibrarian.port}
                  isSSL={lazylibrarian.useSsl}
                  isMagazines={true}
                  isDefault={lazylibrarian.isDefault}
                  externalUrl={lazylibrarian.externalUrl}
                  onEdit={() =>
                    setEditLazyLibrarianModal({
                      open: true,
                      lazylibrarian,
                    })
                  }
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: lazylibrarian.id,
                      type: 'lazylibrarian',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="success"
                    buttonSize="standard"
                    onClick={() =>
                      setEditLazyLibrarianModal({
                        open: true,
                        lazylibrarian: null,
                      })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addlazylibrarian)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
      <ReaderDeliverySettings />
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.overrideRules)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.overrideRulesDescription, {
            serverType: 'Sonarr',
          })}
        </p>
      </div>
      <div className="app-card-sub section settings-service-section">
        <ul className="settings-service-grid">
          {rules && radarrData && sonarrData && lidarrData && readarrData && (
            <OverrideRuleTiles
              rules={rules}
              radarrServices={radarrData}
              sonarrServices={sonarrData}
              lidarrServices={lidarrData}
              readarrServices={readarrData}
              setOverrideRuleModal={setOverrideRuleModal}
              revalidate={revalidate}
            />
          )}
        </ul>
      </div>
      <SettingsProwlarr />
      <SettingsDownloadClients />
      <SettingsTunerr />
      <SettingsSoftwareAcquisition />
      {overrideRuleModal.open &&
        radarrData &&
        sonarrData &&
        lidarrData &&
        readarrData && (
          <OverrideRuleModal
            rule={overrideRuleModal.rule}
            onClose={() => {
              setOverrideRuleModal({
                open: false,
                rule: null,
              });
              revalidate();
            }}
            radarrServices={radarrData}
            sonarrServices={sonarrData}
            lidarrServices={lidarrData}
            readarrServices={readarrData}
          />
        )}
    </>
  );
};

export default SettingsServices;
