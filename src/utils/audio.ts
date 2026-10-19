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

/** Bipe curto e discreto (alarme repetido de pedido novo). */
export function playShortBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.18].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, t + offset);
      gain.gain.setValueAtTime(0.08, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.13);
    });
  } catch { /* navegador bloqueou o áudio */ }
}

/** Destrava o áudio (chamar dentro de um clique/tecla do usuário). */
export function unlockAudio(): void {
  getAudioContext();
}

/** 19/10: Tela da Cozinha — "ding-dong" ascendente, diferente do som de pedido novo. */
export function playReadySound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    [[880, 0], [1320, 0.22]].forEach(([f, at]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + at; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.start(t0); o.stop(t0 + 0.42);
    });
  } catch { /* sem áudio */ }
}
