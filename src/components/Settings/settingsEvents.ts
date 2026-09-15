export const SETTINGS_USER_CHANGE_EVENT = 'seerr:settings-user-change';

export const notifySettingsUserChange = () => {
  window.dispatchEvent(new Event(SETTINGS_USER_CHANGE_EVENT));
};
