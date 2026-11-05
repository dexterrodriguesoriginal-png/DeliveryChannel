import { describe, expect, it } from 'vitest';
import { isYouTubeId, parseYouTubeId, youTubeEmbedUrl, youTubeThumbnailUrl } from '../youtube';

const ID = 'dQw4w9WgXcQ';
describe('YouTube no outdoor: extração do id', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `  https://youtu.be/${ID}  `,
  ])('aceita %s', url => expect(parseYouTubeId(url)).toBe(ID));

  it.each([
    '', '   ', 'não é link', ID,
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://user:pass@youtube.com/watch?v=${ID}`,
    `https://youtube.com:8443/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}"><script>alert(1)</script>`,
    `https://youtube.com/watch?v=abc`,
    `https://youtube.com/watch?v=${ID}X`,
    `https://youtube.com/watch?v=dQw4w9WgXc%22`,
    `https://youtube.com/embed/${ID}`,
    `https://youtube.com/shorts/${ID}/extra`,
    `https://youtu.be/${ID}/x`,
    `https://youtube.com/watch`,
    `ftp://youtube.com/watch?v=${ID}`,
    `data:text/html,<iframe src="https://youtu.be/${ID}">`,
    `https://youtu.be/${'a'.repeat(600)}`,
  ])('recusa %s', url => expect(parseYouTubeId(url)).toBeNull());

  it('monta somente o embed nocookie e a miniatura i.ytimg.com', () => {
    expect(youTubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&mute=1&loop=1&playlist=${ID}&controls=0&playsinline=1`);
    expect(youTubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(() => youTubeEmbedUrl('"><img onerror=x>')).toThrow();
    expect(isYouTubeId(ID)).toBe(true); expect(isYouTubeId(`${ID}&x=1`)).toBe(false); expect(isYouTubeId(null)).toBe(false);
  });
});
