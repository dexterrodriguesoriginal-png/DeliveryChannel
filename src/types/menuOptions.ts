/** Opções operacionais do cardápio da mesa (modo totem etc.). Independentes do Design do Cardápio. */
export interface MenuOptions {
  totemMode: boolean;
  /** Segundos de inatividade antes do aviso "Ainda está aí?" (30–300). */
  idleSeconds: number;
  /** Rótulo do bloco do cardápio na tela inicial do QR (máx. 24 caracteres, texto puro). */
  homeLabel: string;
}
