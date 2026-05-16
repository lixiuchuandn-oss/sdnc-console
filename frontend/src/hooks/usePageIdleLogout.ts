import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;
const ACTIVITY_THROTTLE_MS = 1000;

type UsePageIdleLogoutOptions = {
  enabled: boolean;
  pageTimeoutMinutes: number;
  onIdle: () => void;
};

/**
 * 无操作超过 pageTimeoutMinutes 后触发 onIdle（通常用于自动登出）。
 */
export function usePageIdleLogout({ enabled, pageTimeoutMinutes, onIdle }: UsePageIdleLogoutOptions): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || pageTimeoutMinutes <= 0) return;

    const timeoutMs = pageTimeoutMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastThrottle = 0;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastThrottle < ACTIVITY_THROTTLE_MS) return;
      lastThrottle = now;
      schedule();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
    };
  }, [enabled, pageTimeoutMinutes]);
}
