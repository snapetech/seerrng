export const canRegisterServiceWorker = (
  navigatorLike: Pick<Navigator, 'serviceWorker'> | undefined
) => Boolean(navigatorLike && 'serviceWorker' in navigatorLike);

export const shouldVerifyPushSubscription = ({
  pushNotificationsEnabled,
  userId,
}: {
  pushNotificationsEnabled: boolean;
  userId: number | undefined;
}) => Boolean(userId && pushNotificationsEnabled);

export const createCacheUserMessage = (userId: number | undefined) => ({
  type: 'SET_CACHE_USER' as const,
  userId: userId ?? null,
});

export const postCacheUserToWorker = (
  worker: Pick<ServiceWorker, 'postMessage'> | null | undefined,
  userId: number | undefined
) => worker?.postMessage(createCacheUserMessage(userId));

export const syncRegistrationCacheUser = (
  registration: Pick<
    ServiceWorkerRegistration,
    'active' | 'installing' | 'waiting'
  >,
  userId: number | undefined
) => {
  const workers = [
    registration.active,
    registration.waiting,
    registration.installing,
  ];

  workers.forEach((worker) => postCacheUserToWorker(worker, userId));
};
