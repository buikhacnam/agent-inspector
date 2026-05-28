// USD per 1M tokens. Source: provider docs as of 2026-05. Hardcoded for dev cost estimates.
// Lookup is forgiving — model id may be prefixed (e.g. "openai/gpt-4o-mini"); strip leading provider.
type Price = { input: number; output: number };

const TABLE: Record<string, Price> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

function normalize(modelId: string): string {
  const slash = modelId.indexOf('/');
  const base = slash >= 0 ? modelId.slice(slash + 1) : modelId;
  return base
    .toLowerCase()
    .replace(/[-_:]\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-latest$/, '');
}

export function estimateCostUsd(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const key = normalize(modelId);
  const price = TABLE[key];
  if (!price) return null;
  return (
    (promptTokens * price.input + completionTokens * price.output) / 1_000_000
  );
}
