import { useSyncExternalStore } from 'react';

let searchActive = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSearchActivitySnapshot = () => searchActive;
const getServerSnapshot = () => false;

export const setSearchActivity = (active: boolean): void => {
  if (searchActive === active) {
    return;
  }

  searchActive = active;
  listeners.forEach((listener) => listener());
};

const useSearchActivity = (): boolean =>
  useSyncExternalStore(subscribe, getSearchActivitySnapshot, getServerSnapshot);

export default useSearchActivity;
