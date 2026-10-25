import { useEffect, useState } from 'react';
import { buildLibrary, type ClipFile, type MocapLibrary } from './mocap';

// The recorded clips load on demand (a separate chunk), only when the realistic defender is used.
let cache: Promise<MocapLibrary> | null = null;
export function loadMocap(): Promise<MocapLibrary> {
  cache ??= import('./mocap/clips.json').then((m) => buildLibrary(m.default as ClipFile));
  return cache;
}

/** The clip library once loaded; null while loading, when off, or if it failed (then the procedural body is used). */
export function useMocap(enabled: boolean): MocapLibrary | null {
  const [lib, setLib] = useState<MocapLibrary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let on = true;
    loadMocap()
      .then((l) => on && setLib(l))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [enabled]);
  return enabled ? lib : null;
}
