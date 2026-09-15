import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import {
  CompactSelect,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import BulkEditModal from '@app/components/UserList/BulkEditModal';
import PlexImportModal from '@app/components/UserList/PlexImportModal';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import type { User } from '@app/hooks/useUser';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  isStoredOption,
  readLocalStoredRecord,
  writeLocalStoredRecord,
} from '@app/utils/localStorage';
import { Transition } from '@headlessui/react';
import {
  BarsArrowDownIcon,
  BarsArrowUpIcon,
  InboxArrowDownIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  UserPlusIcon,
} from '@heroicons/react/24/solid';
import { MediaServerType } from '@server/constants/server';
import type { PaginatedResponse } from '@server/interfaces/api/common';
import { hasPermission } from '@server/lib/permissions';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import validator from 'validator';
import * as Yup from 'yup';
import JellyfinImportModal from './JellyfinImportModal';

const messages = defineMessages('components.UserList', {
  users: 'Users',
  userlist: 'User List',
  importfrommediaserver: 'Import {mediaServerName} Users',
  user: 'User',
  totalrequests: 'Requests',
  accounttype: 'Type',
  role: 'Role',
  created: 'Joined',
  filters: 'Filters',
  sortByHeading: 'Sort By',
  keywordSearch: 'Keyword Search',
  searchUsers: 'Search Users',
  any: 'Any',
  allTypes: 'All Types',
  allRoles: 'All Roles',
  userName: 'User Name',
  selectAllUsers: 'Select all users',
  selectUser: 'Select {user}',
  noUsers: 'No users match the selected filters.',
  bulkedit: 'Bulk Edit',
  owner: 'Owner',
  admin: 'Admin',
  plexuser: 'Plex User',
  deleteuser: 'Delete User',
  userdeleted: 'User deleted successfully!',
  userdeleteerror: 'Something went wrong while deleting the user.',
  deleteconfirm:
    'Are you sure you want to delete this user? All of their request data will be permanently removed.',
  localuser: 'Local User',
  mediaServerUser: '{mediaServerName} User',
  createlocaluser: 'Create Local User',
  creating: 'Creating…',
  create: 'Create',
  validationpasswordminchars:
    'Password is too short; should be a minimum of 8 characters',
  usercreatedfailed: 'Something went wrong while creating the user.',
  usercreatedfailedexisting:
    'The provided email address is already in use by another user.',
  usercreatedsuccess: 'User created successfully!',
  username: 'Username',
  email: 'Email Address',
  password: 'Password',
  passwordsetupdescription:
    'Configure an application URL and enable email notifications to send password setup links.',
  sendpasswordsetuplink: 'Send Password Setup Link',
  sendpasswordsetuplinkTip:
    'Email a secure link that lets the user choose a password',
  validationUsername: 'You must provide an username',
  validationEmail: 'Email required',
  sortBy: 'Sort by {field}',
  sortByUser: 'Sort by username',
  sortByRequests: 'Sort by number of requests',
  sortByType: 'Sort by account type',
  sortByRole: 'Sort by user role',
  sortByJoined: 'Sort by join date',
  toggleSortDirection: 'Click again to sort {direction}',
  toggleSortDirectionAria: 'Toggle sort direction',
  ascending: 'ascending',
  descending: 'descending',
  localLoginDisabled:
    'The <strong>Enable Local Sign-In</strong> setting is currently disabled.',
});

type Sort = 'created' | 'requests' | 'displayname' | 'usertype' | 'role';
type SortDirection = 'asc' | 'desc';
const USER_SORT_OPTIONS: readonly Sort[] = [
  'created',
  'requests',
  'displayname',
  'usertype',
  'role',
];
const SORT_DIRECTION_OPTIONS: readonly SortDirection[] = ['asc', 'desc'];

type ClientUserResultsResponse = PaginatedResponse & {
  results: User[];
};

const UserList = () => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const { addToast } = useToasts();
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const [currentSort, setCurrentSort] = useState<Sort>('created');
  const [keywordSearch, debouncedKeywordSearch, setKeywordSearch] =
    useDebouncedState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [filterSettingsHydrated, setFilterSettingsHydrated] = useState(false);

  const defaultSortDirection = (sortKey: Sort): SortDirection =>
    sortKey === 'requests' ? 'desc' : 'asc';

  const [sortDirection, setSortDirection] = useState<SortDirection>(() =>
    defaultSortDirection('created')
  );

  useEffect(() => {
    const filterSettings = readLocalStoredRecord('ul-filter-settings');
    if (filterSettings) {
      if (isStoredOption(filterSettings.currentSort, USER_SORT_OPTIONS)) {
        setCurrentSort(filterSettings.currentSort);
      }
      if (
        isStoredOption(filterSettings.sortDirection, SORT_DIRECTION_OPTIONS)
      ) {
        setSortDirection(filterSettings.sortDirection);
      }
    }
    setFilterSettingsHydrated(true);
  }, []);

  useEffect(() => {
    if (filterSettingsHydrated) {
      writeLocalStoredRecord('ul-filter-settings', {
        currentSort,
        sortDirection,
      });
    }
  }, [currentSort, filterSettingsHydrated, sortDirection]);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<ClientUserResultsResponse>(
    `/api/v1/user?take=100&skip=0&sort=${currentSort}&sortDirection=${sortDirection}${
      debouncedKeywordSearch.trim()
        ? `&q=${encodeURIComponent(debouncedKeywordSearch.trim())}`
        : ''
    }`
  );

  const handleSortChange = (sortKey: Sort) => {
    if (currentSort === sortKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setCurrentSort(sortKey);
      setSortDirection(defaultSortDirection(sortKey));
    }
  };

  const [isDeleting, setDeleting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    user?: User;
  }>({
    isOpen: false,
  });
  const [createModal, setCreateModal] = useState<{
    isOpen: boolean;
  }>({
    isOpen: false,
  });
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);

  const isUserPermsEditable = (userId: number) =>
    userId !== 1 && userId !== currentUser?.id;
  const getUserRole = (user: User) =>
    user.id === 1
      ? 'owner'
      : hasPermission(Permission.ADMIN, user.permissions)
        ? 'admin'
        : 'user';
  const visibleUsers = (data?.results ?? []).filter(
    (user) =>
      (typeFilter === 'all' || user.userType.toString() === typeFilter) &&
      (roleFilter === 'all' || getUserRole(user) === roleFilter)
  );
  const editableVisibleUsers = visibleUsers.filter((user) =>
    isUserPermsEditable(user.id)
  );
  const isAllUsersSelected = () => {
    return (
      editableVisibleUsers.length > 0 &&
      editableVisibleUsers.every((user) => selectedUsers.includes(user.id))
    );
  };
  const areSomeUsersSelected =
    editableVisibleUsers.some((user) => selectedUsers.includes(user.id)) &&
    !isAllUsersSelected();
  const isUserSelected = (userId: number) => selectedUsers.includes(userId);
  const toggleAllUsers = () => {
    if (isAllUsersSelected()) {
      const visibleIds = new Set(editableVisibleUsers.map((user) => user.id));
      setSelectedUsers((users) =>
        users.filter((userId) => !visibleIds.has(userId))
      );
    } else {
      setSelectedUsers((users) => [
        ...new Set([...users, ...editableVisibleUsers.map((user) => user.id)]),
      ]);
    }
  };
  const toggleUser = (userId: number) => {
    if (selectedUsers.includes(userId)) {
      setSelectedUsers((users) => users.filter((u) => u !== userId));
    } else {
      setSelectedUsers((users) => [...users, userId]);
    }
  };

  const deleteUser = async () => {
    setDeleting(true);

    try {
      await axios.delete(`/api/v1/user/${deleteModal.user?.id}`);

      addToast(intl.formatMessage(messages.userdeleted), {
        autoDismiss: true,
        appearance: 'success',
      });
      setDeleteModal({ isOpen: false, user: deleteModal.user });
    } catch {
      addToast(intl.formatMessage(messages.userdeleteerror), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setDeleting(false);
      revalidate();
    }
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const CreateUserSchema = Yup.object().shape({
    username: Yup.string().required(
      intl.formatMessage(messages.validationUsername)
    ),
    email: Yup.string()
      .required()
      .test(
        'email',
        intl.formatMessage(messages.validationEmail),
        (value) => !value || validator.isEmail(value, { require_tld: false })
      ),
    password: Yup.lazy((value) =>
      !value
        ? Yup.string()
        : Yup.string().min(
            8,
            intl.formatMessage(messages.validationpasswordminchars)
          )
    ),
  });

  if (!data) {
    return <LoadingSpinner />;
  }

  const passwordGenerationEnabled =
    settings.currentSettings.applicationUrl &&
    settings.currentSettings.emailEnabled;
  const mediaServerName =
    settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? 'Plex'
      : settings.currentSettings.mediaServerType === MediaServerType.EMBY
        ? 'Emby'
        : 'Jellyfin';
  const typeOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'all' },
    { label: intl.formatMessage(messages.localuser), value: '2' },
    { label: intl.formatMessage(messages.plexuser), value: '1' },
    {
      label: intl.formatMessage(messages.mediaServerUser, {
        mediaServerName: 'Jellyfin',
      }),
      value: '3',
    },
    {
      label: intl.formatMessage(messages.mediaServerUser, {
        mediaServerName: 'Emby',
      }),
      value: '4',
    },
  ];
  const roleOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'all' },
    { label: intl.formatMessage(messages.owner), value: 'owner' },
    { label: intl.formatMessage(messages.admin), value: 'admin' },
    { label: intl.formatMessage(messages.user), value: 'user' },
  ];
  const sortOptions: { key: Sort; label: string }[] = [
    { key: 'created', label: intl.formatMessage(messages.created) },
    { key: 'displayname', label: intl.formatMessage(messages.userName) },
    { key: 'requests', label: intl.formatMessage(messages.totalrequests) },
    { key: 'usertype', label: intl.formatMessage(messages.accounttype) },
    { key: 'role', label: intl.formatMessage(messages.role) },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.users)} />
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={deleteModal.isOpen}
      >
        <Modal
          onOk={() => deleteUser()}
          okText={
            isDeleting
              ? intl.formatMessage(globalMessages.deleting)
              : intl.formatMessage(globalMessages.delete)
          }
          okDisabled={isDeleting}
          okButtonType="danger"
          onCancel={() =>
            setDeleteModal({ isOpen: false, user: deleteModal.user })
          }
          title={intl.formatMessage(messages.deleteuser)}
          subTitle={deleteModal.user?.username}
        >
          {intl.formatMessage(messages.deleteconfirm)}
        </Modal>
      </Transition>

      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={createModal.isOpen}
      >
        <Formik
          initialValues={{
            username: '',
            email: '',
            password: '',
            genpassword: false,
          }}
          validationSchema={CreateUserSchema}
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/user', {
                username: values.username,
                email: values.email,
                password: values.genpassword ? null : values.password,
              });
              addToast(intl.formatMessage(messages.usercreatedsuccess), {
                appearance: 'success',
                autoDismiss: true,
              });
              setCreateModal({ isOpen: false });
            } catch (e) {
              addToast(
                intl.formatMessage(
                  e?.response?.data?.errors?.includes('USER_EXISTS')
                    ? messages.usercreatedfailedexisting
                    : messages.usercreatedfailed
                ),
                {
                  appearance: 'error',
                  autoDismiss: true,
                }
              );
            } finally {
              revalidate();
            }
          }}
        >
          {({
            errors,
            touched,
            isSubmitting,
            values,
            isValid,
            setFieldValue,
            handleSubmit,
          }) => {
            return (
              <Modal
                title={intl.formatMessage(messages.createlocaluser)}
                onOk={() => handleSubmit()}
                okText={
                  isSubmitting
                    ? intl.formatMessage(messages.creating)
                    : intl.formatMessage(messages.create)
                }
                okDisabled={isSubmitting || !isValid}
                okButtonType="primary"
                onCancel={() => setCreateModal({ isOpen: false })}
              >
                {!settings.currentSettings.localLogin && (
                  <Alert
                    title={intl.formatMessage(messages.localLoginDisabled, {
                      strong: (msg: React.ReactNode) => (
                        <strong className="font-semibold text-white">
                          {msg}
                        </strong>
                      ),
                    })}
                    type="warning"
                  />
                )}
                {currentHasPermission(Permission.ADMIN) &&
                  !passwordGenerationEnabled && (
                    <Alert
                      title={intl.formatMessage(
                        messages.passwordsetupdescription
                      )}
                      type="info"
                    />
                  )}
                <Form className="section">
                  <div className="form-row">
                    <label htmlFor="username" className="text-label">
                      {intl.formatMessage(messages.username)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field id="username" name="username" type="text" />
                      </div>
                      {errors.username &&
                        touched.username &&
                        typeof errors.username === 'string' && (
                          <div className="error">{errors.username}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="email" className="text-label">
                      {intl.formatMessage(messages.email)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          id="email"
                          name="email"
                          type="text"
                          inputMode="email"
                          autoComplete="off"
                          data-form-type="other"
                          data-1pignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                        />
                      </div>
                      {errors.email &&
                        touched.email &&
                        typeof errors.email === 'string' && (
                          <div className="error">{errors.email}</div>
                        )}
                    </div>
                  </div>
                  <div
                    className={`form-row ${
                      passwordGenerationEnabled ? '' : 'opacity-50'
                    }`}
                  >
                    <label htmlFor="genpassword" className="checkbox-label">
                      {intl.formatMessage(messages.sendpasswordsetuplink)}
                      <span className="label-tip">
                        {intl.formatMessage(messages.sendpasswordsetuplinkTip)}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <Field
                        type="checkbox"
                        id="genpassword"
                        name="genpassword"
                        disabled={!passwordGenerationEnabled}
                        onClick={() => setFieldValue('password', '')}
                      />
                    </div>
                  </div>
                  <div
                    className={`form-row ${
                      values.genpassword ? 'opacity-50' : ''
                    }`}
                  >
                    <label htmlFor="password" className="text-label">
                      {intl.formatMessage(messages.password)}
                      {!values.genpassword && (
                        <span className="label-required">*</span>
                      )}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <SensitiveInput
                          as="field"
                          id="password"
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          disabled={values.genpassword}
                        />
                      </div>
                      {errors.password &&
                        touched.password &&
                        typeof errors.password === 'string' && (
                          <div className="error">{errors.password}</div>
                        )}
                    </div>
                  </div>
                </Form>
              </Modal>
            );
          }}
        </Formik>
      </Transition>

      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={showBulkEditModal}
      >
        <BulkEditModal
          onCancel={() => setShowBulkEditModal(false)}
          onComplete={() => {
            setShowBulkEditModal(false);
            revalidate();
          }}
          selectedUserIds={selectedUsers}
          users={data.results}
        />
      </Transition>

      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={showImportModal}
      >
        {settings.currentSettings.mediaServerType === MediaServerType.PLEX ? (
          <PlexImportModal
            onCancel={() => setShowImportModal(false)}
            onComplete={() => {
              setShowImportModal(false);
              revalidate();
            }}
          />
        ) : (
          <JellyfinImportModal
            onCancel={() => setShowImportModal(false)}
            onComplete={() => {
              setShowImportModal(false);
              revalidate();
            }}
          >
            {data.pageInfo.results}
          </JellyfinImportModal>
        )}
      </Transition>

      <Header>{intl.formatMessage(messages.userlist)}</Header>
      <article className="refreshed-card-surface mt-5 rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        <div className="text-sm text-gray-300">
          {intl.formatMessage(messages.filters)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form
            className="discover-filter-control w-72 max-w-full"
            onSubmit={(event) => event.preventDefault()}
          >
            <span className="discover-filter-control-label gap-1.5">
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
              {intl.formatMessage(messages.keywordSearch)}
            </span>
            <input
              type="search"
              value={keywordSearch}
              onChange={(event) => setKeywordSearch(event.target.value)}
              placeholder={intl.formatMessage(messages.searchUsers)}
              aria-label={intl.formatMessage(messages.searchUsers)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </form>
          <CompactSelect
            label={intl.formatMessage(messages.accounttype)}
            value={typeFilter}
            options={typeOptions}
            onChange={setTypeFilter}
          />
          <CompactSelect
            label={intl.formatMessage(messages.role)}
            value={roleFilter}
            options={roleOptions}
            onChange={setRoleFilter}
          />
        </div>

        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.sortByHeading)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortOptions.map((option) => {
            const active = currentSort === option.key;
            const Icon =
              active && sortDirection === 'asc'
                ? BarsArrowUpIcon
                : BarsArrowDownIcon;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => handleSortChange(option.key)}
                className={getFilterToggleButtonClass(active)}
              >
                {option.label}
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className="refreshed-inset-surface mt-5 overflow-hidden rounded-lg border border-gray-700">
          <div className="user-list-table-scroll scrollable-card overflow-auto">
            <table className="app-data-table user-list-data-table">
              <thead className="app-data-table-head">
                <tr className="app-data-table-header-row">
                  <th className="app-data-table-heading user-list-select-column">
                    {editableVisibleUsers.length > 0 && (
                      <SelectionCircle
                        selected={isAllUsersSelected()}
                        partial={areSomeUsersSelected}
                        label={intl.formatMessage(messages.selectAllUsers)}
                        onClick={toggleAllUsers}
                      />
                    )}
                  </th>
                  <th className="app-data-table-heading user-list-name-column">
                    {intl.formatMessage(messages.user)}
                  </th>
                  <th className="app-data-table-heading user-list-requests-column text-center">
                    {intl.formatMessage(messages.totalrequests)}
                  </th>
                  <th className="app-data-table-heading user-list-type-column">
                    {intl.formatMessage(messages.accounttype)}
                  </th>
                  <th className="app-data-table-heading user-list-role-column">
                    {intl.formatMessage(messages.role)}
                  </th>
                  <th className="app-data-table-heading user-list-joined-column">
                    {intl.formatMessage(messages.created)}
                  </th>
                  <th className="app-data-table-heading user-list-actions-column" />
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const displayName =
                    user.username ||
                    user.jellyfinUsername ||
                    user.plexUsername ||
                    user.email;
                  return (
                    <tr
                      key={`user-list-${user.id}`}
                      className="app-data-table-row"
                      data-testid="user-list-row"
                    >
                      <td className="app-data-table-cell user-list-select-column">
                        {isUserPermsEditable(user.id) && (
                          <SelectionCircle
                            selected={isUserSelected(user.id)}
                            label={intl.formatMessage(messages.selectUser, {
                              user: displayName,
                            })}
                            onClick={() => toggleUser(user.id)}
                          />
                        )}
                      </td>
                      <td className="app-data-table-cell">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/users/${user.id}`}
                            className="h-8 w-8 flex-shrink-0"
                          >
                            <CachedImage
                              type="avatar"
                              className="h-8 w-8 rounded-full object-cover"
                              src={user.avatar}
                              alt=""
                              width={32}
                              height={32}
                            />
                          </Link>
                          <div className="min-w-0">
                            <Link
                              href={`/users/${user.id}`}
                              className="block truncate text-xs leading-4 font-semibold transition duration-300 hover:underline"
                              data-testid="user-list-username-link"
                            >
                              {displayName}
                            </Link>
                            {(
                              user.username ||
                              user.jellyfinUsername ||
                              user.plexUsername
                            )?.toLowerCase() !== user.email && (
                              <div className="refreshed-detail-text-muted truncate text-xs leading-4">
                                {user.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="app-data-table-cell text-center">
                        {user.id === currentUser?.id ||
                        currentHasPermission(
                          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                          { type: 'or' }
                        ) ? (
                          <Link
                            href={`/users/${user.id}/requests`}
                            className="transition duration-300 hover:underline"
                          >
                            {user.requestCount}
                          </Link>
                        ) : (
                          user.requestCount
                        )}
                      </td>
                      <td className="app-data-table-cell">
                        {user.userType === UserType.PLEX ? (
                          <Badge badgeType="warning">
                            {intl.formatMessage(messages.plexuser)}
                          </Badge>
                        ) : user.userType === UserType.LOCAL ? (
                          <Badge badgeType="default">
                            {intl.formatMessage(messages.localuser)}
                          </Badge>
                        ) : user.userType === UserType.EMBY ? (
                          <Badge badgeType="success">
                            {intl.formatMessage(messages.mediaServerUser, {
                              mediaServerName: 'Emby',
                            })}
                          </Badge>
                        ) : user.userType === UserType.JELLYFIN ? (
                          <Badge badgeType="default">
                            {intl.formatMessage(messages.mediaServerUser, {
                              mediaServerName: 'Jellyfin',
                            })}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="app-data-table-cell">
                        {user.id === 1
                          ? intl.formatMessage(messages.owner)
                          : hasPermission(Permission.ADMIN, user.permissions)
                            ? intl.formatMessage(messages.admin)
                            : intl.formatMessage(messages.user)}
                      </td>
                      <td className="app-data-table-cell">
                        {intl.formatDate(user.createdAt, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="app-data-table-cell">
                        <div className="flex justify-end gap-[5px]">
                          <Button
                            buttonType="warning"
                            buttonSize="standard"
                            disabled={user.id === 1 && currentUser?.id !== 1}
                            onClick={() =>
                              router.push(
                                '/users/[userId]/settings',
                                `/users/${user.id}/settings`
                              )
                            }
                          >
                            {intl.formatMessage(globalMessages.edit)}
                          </Button>
                          <Button
                            buttonType="danger"
                            buttonSize="standard"
                            disabled={
                              user.id === 1 ||
                              (currentUser?.id !== 1 &&
                                hasPermission(
                                  Permission.ADMIN,
                                  user.permissions
                                ))
                            }
                            onClick={() =>
                              setDeleteModal({ isOpen: true, user })
                            }
                          >
                            {intl.formatMessage(globalMessages.delete)}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleUsers.length === 0 && (
                  <tr className="app-data-table-row">
                    <td className="app-data-table-cell text-center" colSpan={7}>
                      {intl.formatMessage(messages.noUsers)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button
            buttonType="primary"
            buttonSize="standard"
            onClick={() => setCreateModal({ isOpen: true })}
          >
            <UserPlusIcon />
            <span>{intl.formatMessage(messages.createlocaluser)}</span>
          </Button>
          <Button
            buttonType="primary"
            buttonSize="standard"
            onClick={() => setShowImportModal(true)}
          >
            <InboxArrowDownIcon />
            <span>
              {intl.formatMessage(messages.importfrommediaserver, {
                mediaServerName,
              })}
            </span>
          </Button>
          <Button
            buttonType="warning"
            buttonSize="standard"
            onClick={() => setShowBulkEditModal(true)}
            disabled={selectedUsers.length === 0}
          >
            <PencilIcon />
            <span>{intl.formatMessage(messages.bulkedit)}</span>
          </Button>
        </div>
      </article>
    </>
  );
};

export default UserList;
