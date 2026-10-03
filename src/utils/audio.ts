// Utilitário de Som Web Audio API nativo do navegador
// Gera síntese de sino/campainha estridente (Ré5 587.33 Hz -> Lá5 880.00 Hz) sem necessidade de MP3 externo

let audioCtxInstance: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtxInstance) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioCtxInstance = new AudioCtx();
      }
    }
    if (audioCtxInstance && audioCtxInstance.state === 'suspended') {
      audioCtxInstance.resume().catch(() => {});
    }
    return audioCtxInstance;
  } catch {
    return null;
  }
}

export function playNewOrderSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Frequência Ré5 (587.33 Hz) para Lá5 (880.00 Hz)
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15);

    // Fade out exponencial com volume controlado
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  } catch (err) {
    console.warn('[Audio] Reprodução de áudio restrita pelo navegador até primeira interação:', err);
  }
}
