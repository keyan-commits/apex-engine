// Char-based heuristic. ~4 chars/token across English text for most tokenizers.
// Not exact — labelled "approx" everywhere it surfaces. Avoids loading a tokenizer
// in the client bundle (tiktoken ≈ 1 MB) for what's only ever a cost preview.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}
