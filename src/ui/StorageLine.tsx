import { useEffect, useState } from 'react';
import { storageMB } from '../app/storage';

/** "Storage used: X MB of Y MB" from the browser's estimate (audit 2026-10-29, task 8). */
export function StorageLine() {
  const [s, setS] = useState<Awaited<ReturnType<typeof storageMB>>>();
  useEffect(() => {
    void storageMB().then(setS);
  }, []);
  if (!s) return null;
  return (
    <p className="muted" data-testid="storage-line">
      Storage used: {s.usedMB} MB of {s.quotaMB} MB.
    </p>
  );
}
