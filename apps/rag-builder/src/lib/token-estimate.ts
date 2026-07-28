// Közelítő token-becslés (karakter/4). Pontos tokenizáló nem cél SP2-ben.

/** Egy szöveg közelítő token-száma (≈ karakterszám / 4, felfelé kerekítve). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
