import React, { useEffect, useRef } from 'react';
import { youTubeEmbedUrl } from '../../../lib/youtube';

export const OUTDOOR_YOUTUBE_FALLBACK_SECONDS = 60;

type Player = {
  getDuration(): number;
  mute(): void;
  playVideo(): void;
  destroy(): void;
};
type PlayerOptions = { events: {
  onReady(event: { target: Player }): void;
  onStateChange(event: { data: number; target: Player }): void;
  onError(): void;
} };
type YouTubeWindow = Window & {
  YT?: { Player: new (frame: HTMLIFrameElement, options: PlayerOptions) => Player };
  onYouTubeIframeAPIReady?: () => void;
};

const apiListeners = new Set<() => void>();
let pendingScript: HTMLScriptElement | undefined;
let resetAPI: (() => void) | undefined;
function loadAPI(ready: () => void): () => void {
  const host = window as YouTubeWindow;
  if (host.YT?.Player) { ready(); return () => {}; }
  apiListeners.add(ready);
  if (!pendingScript) {
    const previous = host.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    pendingScript = script;
    const reset = () => {
      if (host.onYouTubeIframeAPIReady === callback) host.onYouTubeIframeAPIReady = previous;
      script.onerror = null;
      script.remove();
      pendingScript = undefined;
      resetAPI = undefined;
    };
    const callback = () => {
      const listeners = [...apiListeners];
      apiListeners.clear();
      reset();
      try { previous?.(); } finally { listeners.forEach(listener => listener()); }
    };
    resetAPI = reset;
    host.onYouTubeIframeAPIReady = callback;
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { apiListeners.clear(); reset(); };
    document.head.appendChild(script);
  }
  return () => {
    apiListeners.delete(ready);
    if (!apiListeners.size) resetAPI?.();
  };
}

/** A API controla a duração; 60 s protegem o carrossel quando ela falha. */
export function OutdoorYouTubePlayer({ youtubeId, onEnded, loop = false, ...props }: {
  youtubeId: string;
  onEnded(): void;
  loop?: boolean;
} & Omit<React.IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'onEnded'>) {
  const frame = useRef<HTMLIFrameElement>(null);
  const advance = useRef(onEnded);
  advance.current = onEnded;
  useEffect(() => {
    const element = frame.current;
    let disposed = false;
    let finished = false;
    let player: Player | undefined;
    const finish = () => {
      if (disposed || finished) return;
      finished = true;
      advance.current();
    };
    let timer = window.setTimeout(finish, OUTDOOR_YOUTUBE_FALLBACK_SECONDS * 1000);
    const fallback = () => {
      if (disposed || finished) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, OUTDOOR_YOUTUBE_FALLBACK_SECONDS * 1000);
    };
    const useDuration = (target: Player) => {
      const duration = target.getDuration();
      if (Number.isFinite(duration) && duration > 0) {
        window.clearTimeout(timer);
        // ENDED is authoritative: buffering must never shorten the video.
      }
    };
    const unsubscribe = loadAPI(() => {
      if (disposed || finished || !frame.current) return;
      const host = window as YouTubeWindow;
      try { player = new host.YT!.Player(frame.current, { events: {
        onReady: ({ target }) => {
          if (disposed) return;
          target.mute(); target.playVideo(); useDuration(target);
        },
        onStateChange: ({ data, target }) => {
          if (disposed) return;
          if (data === 0) {
            if (loop) { target.playVideo(); } else finish();
          } else if (data === 1) useDuration(target);
        },
        onError: fallback,
      } }); } catch { fallback(); }
    });
    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(timer);
      // YouTube removes the iframe; restore React's node for cleanup/StrictMode replay.
      const parent = element?.parentNode;
      const sibling = element?.nextSibling;
      player?.destroy();
      if (element && parent && element.parentNode !== parent) parent.insertBefore(element, sibling ?? null);
    };
  }, [youtubeId, loop]);
  const src = `${youTubeEmbedUrl(youtubeId).replace(/&loop=1&playlist=[^&]+/, loop ? `&loop=1&playlist=${youtubeId}` : '')}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
  return <iframe {...props} ref={frame} src={src} allow="autoplay; encrypted-media; picture-in-picture" />;
}
