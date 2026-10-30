import { useEffect, useState } from 'react';

type W = Window & { __waitingWorker?: ServiceWorker; __updating?: boolean };

/** A new app version that is installed and waiting (audit task 15). Shown on Home only, never in a session. */
export function useAppUpdate(): { ready: boolean; update: () => void } {
  const [worker, setWorker] = useState<ServiceWorker | undefined>(() => (window as W).__waitingWorker);
  useEffect(() => {
    const on = (e: Event) => setWorker((e as CustomEvent<ServiceWorker>).detail);
    window.addEventListener('app-update', on);
    return () => window.removeEventListener('app-update', on);
  }, []);
  return {
    ready: !!worker,
    update: () => {
      (window as W).__updating = true;
      worker?.postMessage('skipWaiting');
    },
  };
}
