import { useEffect, useRef } from 'react';

/**
 * Like setInterval but pauses when the tab is hidden (document.visibilityState !== 'visible').
 * When the tab becomes visible again the callback fires immediately, then the interval resumes.
 */
export function useVisibleInterval(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (id) return;
      id = setInterval(() => savedCallback.current(), delayMs);
    }

    function stop() {
      if (id) {
        clearInterval(id);
        id = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        savedCallback.current();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [delayMs]);
}
