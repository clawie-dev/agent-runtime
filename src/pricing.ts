/**
 * Phase 3 pricing table. Static, per-model, US dollars per million tokens.
 * Numbers here are placeholders the broker stub will replace once spec 012
 * lands; treat them as illustrative, not authoritative. Unknown models
 * fall back to `null`, and the chat envelope reports `cost_unknown: true`.
 */

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

const TABLE: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  // OpenAI
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
}

export function priceFor(model: string): ModelPricing | null {
  return TABLE[model] ?? null
}

export function costUsdCents(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number
): number {
  const usd =
    (inputTokens * pricing.inputPerMTok) / 1_000_000 +
    (outputTokens * pricing.outputPerMTok) / 1_000_000
  // Round to nearest tenth of a cent — sub-cent matters for cheap models.
  return Math.round(usd * 1000) / 10
}
