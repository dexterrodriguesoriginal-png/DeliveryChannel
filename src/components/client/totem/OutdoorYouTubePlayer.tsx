import React, { useEffect, useRef } from 'react';
import { youTubeEmbedUrl } from '../../../lib/youtube';

export const OUTDOOR_YOUTUBE_FALLBACK_SECONDS = 60;

type Player = {
  getDuration(): number;
  getCurrentTime(): number;
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

let apiPromise: Promise<void> | undefined;
function loadAPI(): Promise<void> {
  const host = window as YouTubeWindow;
  if (host.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise<void>((resolve, reject) => {
      const previous = host.onYouTubeIframeAPIReady;
      host.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { apiPromise = undefined; script.remove(); reject(new Error('Não foi possível carregar o YouTube.')); };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
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
    let disposed = false;
    let finished = false;
    let durationKnown = false;
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
        durationKnown = true;
        window.clearTimeout(timer);
        if (!loop) timer = window.setTimeout(finish, Math.max(0, duration - target.getCurrentTime()) * 1000);
      }
    };
    loadAPI().then(() => {
      if (disposed || !frame.current) return;
      const host = window as YouTubeWindow;
      player = new host.YT!.Player(frame.current, { events: {
        onReady: ({ target }) => {
          if (disposed) return;
          target.mute(); target.playVideo(); useDuration(target);
        },
        onStateChange: ({ data, target }) => {
          if (disposed) return;
          if (data === 0) {
            if (loop) { target.playVideo(); } else finish();
          } else if (data === 1) useDuration(target);
          else if (durationKnown && (data === 2 || data === 3)) window.clearTimeout(timer);
        },
        onError: fallback,
      } });
    }).catch(() => { /* O temporizador inicial mantém o fallback sem a API. */ });
    return () => { disposed = true; window.clearTimeout(timer); player?.destroy(); };
  }, [youtubeId, loop]);
  const src = `${youTubeEmbedUrl(youtubeId).replace(/&loop=1&playlist=[^&]+/, loop ? `&loop=1&playlist=${youtubeId}` : '')}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
  return <iframe {...props} ref={frame} src={src} allow="autoplay; encrypted-media; picture-in-picture" />;
}
