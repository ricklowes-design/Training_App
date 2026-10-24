import { useEffect, useRef, useState } from 'react';
import type { Drill } from '../content/types';
import { db } from '../db/db';

// Demonstration: the player's own clip (looped), or a YouTube embed through the
// official IFrame Player API, with a fallback when the video cannot play here.

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = /^\/(embed|shorts|live)\/([\w-]{6,})/.exec(u.pathname);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

interface YTPlayer {
  destroy(): void;
  pauseVideo(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: { videoId: string; playerVars?: Record<string, number | string>; events?: Record<string, (e: { data: number }) => void> },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytLoading) return ytLoading;
  ytLoading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytLoading = null;
      reject(new Error('offline'));
    };
    document.head.appendChild(s);
  });
  return ytLoading;
}

function Fallback({ drill, reason, url }: { drill: Drill; reason: string; url?: string }) {
  return (
    <div style={{ padding: 24, textAlign: 'left' }} className="stack">
      <p>
        <strong>{reason}</strong>
      </p>
      {drill.demo.outsideMustShow ? <p>What the demonstration shows: {drill.demo.outsideMustShow}</p> : null}
      {drill.demo.outsideSearchPhrase ? <p className="muted">Search phrase for a parent: "{drill.demo.outsideSearchPhrase}"</p> : null}
      {url ? (
        <a className="btn small" href={url} target="_blank" rel="noreferrer">
          Open on YouTube
        </a>
      ) : null}
      <p className="muted">{drill.demo.status}</p>
    </div>
  );
}

export function DemoVideo({ drill, hasOwnClip, onPlayingChange }: { drill: Drill; hasOwnClip: boolean; onPlayingChange?: (playing: boolean) => void }) {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const useOwn = hasOwnClip && (drill.demo.type === 'own' || drill.demo.type === 'none' || !drill.demo.ref);
  const vid = !useOwn && drill.demo.type === 'youtube' ? youtubeId(drill.demo.ref) : null;

  useEffect(() => {
    if (!useOwn) return;
    let url: string | null = null;
    db.demoClips.get(drill.id).then((c) => {
      if (c) {
        url = URL.createObjectURL(c.blob);
        setClipUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [drill.id, useOwn]);

  useEffect(() => {
    if (!vid || !holder.current) return;
    setYtError(null);
    let player: YTPlayer | null = null;
    let cancelled = false;
    const el = document.createElement('div');
    holder.current.appendChild(el);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(el, {
          videoId: vid,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, loop: 1, playlist: vid },
          events: {
            onStateChange: (e) => onPlayingChange?.(e.data === 1 || e.data === 3),
            onError: (e) =>
              setYtError(e.data === 101 || e.data === 150 ? 'The uploader does not allow this video to play inside other apps.' : 'This video cannot be played here.'),
          },
        });
      })
      .catch(() => setYtError('YouTube could not be reached (no Wi-Fi?).'));
    return () => {
      cancelled = true;
      onPlayingChange?.(false);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      el.remove();
    };
  }, [vid, onPlayingChange]);

  if (useOwn) {
    return (
      <div className="video">
        {clipUrl ? (
          <video src={clipUrl} autoPlay loop muted playsInline controls onPlay={() => onPlayingChange?.(true)} onPause={() => onPlayingChange?.(false)} />
        ) : (
          <span className="muted">Loading clip…</span>
        )}
      </div>
    );
  }
  if (vid) {
    return <div className="video">{ytError ? <Fallback drill={drill} reason={ytError} url={drill.demo.ref} /> : <div ref={holder} style={{ width: '100%', height: '100%' }} />}</div>;
  }
  return (
    <div className="video">
      <Fallback drill={drill} reason={drill.demo.ownDemoPlanned ? 'Own demonstration not recorded yet.' : 'No demonstration for this drill.'} />
    </div>
  );
}
