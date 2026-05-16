import { useEffect, useState } from 'react';
import { formatLoginLockRemaining, getRemainSecFromLockedUntil } from '../../utils/loginLockMessage';

/** 登录锁定提示：每秒刷新剩余时间文案 */
export function useLoginLockCountdown(
  lockedUntil: number | null,
  onExpired?: () => void,
): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (lockedUntil == null) {
      setMessage(null);
      return;
    }

    const tick = () => {
      const remainSec = getRemainSecFromLockedUntil(lockedUntil);
      if (remainSec <= 0) {
        setMessage(null);
        onExpired?.();
        return;
      }
      setMessage(formatLoginLockRemaining(remainSec));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil, onExpired]);

  return message;
}
