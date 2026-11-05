/** Opções operacionais do cardápio da mesa (modo totem etc.). Independentes do Design do Cardápio. */
export interface MenuOptions {
  totemMode: boolean;
  /** Segundos de inatividade antes do aviso "Ainda está aí?" (30–300). */
  idleSeconds: number;
}
