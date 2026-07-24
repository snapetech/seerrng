import { acquireInlineStyleLease } from '@app/utils/inlineStyleLease';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

const PULL_INITIAL_THRESHOLD = 20;
const PULL_ICON_STOP = 120;
const PULL_RELOAD_THRESHOLD = 340;
const RESET_DELAY_MS = 200;
const RELOAD_DELAY_MS = 1_000;

type PullToRefreshControllerProps = {
  reload: () => void;
};

export const PullToRefreshController = ({
  reload,
}: PullToRefreshControllerProps) => {
  const [pullChange, setPullChange] = useState(0);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const reloadRef = useRef(reload);

  reloadRef.current = reload;

  useEffect(() => {
    let active = false;
    let startPoint = 0;
    let currentPull = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let releaseStyleLocks: (() => void) | undefined;

    const clearResetTimer = () => {
      if (resetTimer !== undefined) {
        clearTimeout(resetTimer);
        resetTimer = undefined;
      }
    };

    const restoreStyles = () => {
      releaseStyleLocks?.();
      releaseStyleLocks = undefined;
    };

    const lockStyles = () => {
      if (releaseStyleLocks) {
        return;
      }
      const releases = [
        acquireInlineStyleLease(document.body, 'touchAction', 'none'),
        acquireInlineStyleLease(document.body, 'overscrollBehavior', 'none'),
        acquireInlineStyleLease(
          document.documentElement,
          'overscrollBehaviorY',
          'none'
        ),
      ];
      releaseStyleLocks = () => {
        for (let index = releases.length - 1; index >= 0; index -= 1) {
          releases[index]();
        }
      };
    };

    const resetPull = () => {
      active = false;
      startPoint = 0;
      currentPull = 0;
      restoreStyles();
      setPullChange(0);
      clearResetTimer();
      resetTimer = setTimeout(() => {
        resetTimer = undefined;
        setVisible(false);
      }, RESET_DELAY_MS);
    };

    const pullStart = (event: TouchEvent) => {
      const touch = event.targetTouches[0];
      if (!touch || window.scrollY !== 0 || window.scrollX !== 0) {
        resetPull();
        return;
      }

      clearResetTimer();
      active = true;
      startPoint = touch.screenY;
      currentPull = 0;
      setPullChange(0);
      setVisible(true);
    };

    const pullDown = (event: TouchEvent) => {
      const touch = event.targetTouches[0];
      if (!active || !touch) {
        return;
      }

      currentPull = Math.max(0, touch.screenY - startPoint);
      if (currentPull <= 0) {
        resetPull();
        return;
      }

      event.preventDefault();
      if (currentPull > PULL_INITIAL_THRESHOLD) {
        lockStyles();
      }
      setPullChange(currentPull);
    };

    const pullFinish = () => {
      if (!active) {
        return;
      }

      active = false;
      startPoint = 0;
      restoreStyles();
      if (currentPull > PULL_RELOAD_THRESHOLD) {
        currentPull = 0;
        setPullChange(0);
        setLoading(true);
        if (reloadTimer !== undefined) {
          clearTimeout(reloadTimer);
        }
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined;
          reloadRef.current();
        }, RELOAD_DELAY_MS);
      } else {
        resetPull();
      }
    };

    window.addEventListener('touchstart', pullStart, { passive: false });
    window.addEventListener('touchmove', pullDown, { passive: false });
    window.addEventListener('touchend', pullFinish, { passive: false });
    window.addEventListener('touchcancel', resetPull, { passive: false });

    return () => {
      window.removeEventListener('touchstart', pullStart);
      window.removeEventListener('touchmove', pullDown);
      window.removeEventListener('touchend', pullFinish);
      window.removeEventListener('touchcancel', resetPull);
      clearResetTimer();
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer);
      }
      restoreStyles();
    };
  }, []);

  if (!visible && !loading) {
    return null;
  }

  const passedInitialThreshold = pullChange > PULL_INITIAL_THRESHOLD;
  const passedReloadThreshold = pullChange > PULL_RELOAD_THRESHOLD;
  const pullDownIconLocation = pullChange / 3;

  return (
    <div
      className="absolute left-0 right-0 top-0 z-50 m-auto w-fit transition-all ease-out"
      id="refreshIcon"
      style={{
        top: passedInitialThreshold
          ? Math.min(pullDownIconLocation, PULL_ICON_STOP)
          : undefined,
      }}
    >
      <div
        className={`${
          loading ? 'animate-spin' : ''
        }relative -top-28 h-9 w-9 rounded-full border-4 border-gray-800 bg-gray-800 shadow-md shadow-black ring-1 ring-gray-700`}
        style={{ animationDirection: 'reverse' }}
      >
        <ArrowPathIcon
          className={`rounded-full${
            passedReloadThreshold ? 'rotate-180' : ''
          } text-indigo-500 transition-all duration-300`}
        />
      </div>
    </div>
  );
};

const PullToRefresh = () => {
  const router = useRouter();

  return <PullToRefreshController reload={router.reload} />;
};

export default PullToRefresh;
