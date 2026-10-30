import { useEffect } from 'react';

/** Keeps the screen on while `active`. The lock drops whenever the page is hidden, so it is asked for again on return (audit task 11). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const get = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed (battery saver): the screen may dim */
      }
    };
    const onVis = () => void get();
    void get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
