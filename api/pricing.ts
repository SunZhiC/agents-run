/**
 * API Token Pricing Data for All Providers
 *
 * Prices are per 1 million tokens (USD).
 * Sources:
 *   - Claude: https://platform.claude.com/docs/en/about-claude/pricing
 *   - OpenAI: https://openai.com/api/pricing
 *   - Gemini: https://ai.google.dev/gemini-api/docs/pricing
 *
 * Last updated: 2026-03-21
 */

export interface ModelPricing {
  /** Display name */
  name: string;
  /** Provider: claude | codex | gemini */
  provider: "claude" | "codex" | "gemini";
  /** Input price per 1M tokens */
  input: number;
  /** Output price per 1M tokens */
  output: number;
  /** Cache write (5-min TTL) price per 1M tokens — Claude only */
  cacheWrite5m?: number;
  /** Cache write (1-hour TTL) price per 1M tokens — Claude only */
  cacheWrite1h?: number;
  /** Cache read price per 1M tokens */
  cacheRead?: number;
  /** Long-context input price per 1M tokens (when input > 200K tokens) */
  longContextInput?: number;
  /** Long-context output price per 1M tokens (when input > 200K tokens) */
  longContextOutput?: number;
}

// ---------------------------------------------------------------------------
// Claude Models
// ---------------------------------------------------------------------------

export const CLAUDE_PRICING: Record<string, ModelPricing> = {
  // Current models
  "claude-opus-4-6": {
    name: "Claude Opus 4.6",
    provider: "claude",
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,   // 1.25x input
    cacheWrite1h: 10.0,   // 2x input
    cacheRead: 0.5,       // 0.1x input
  },
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6",
    provider: "claude",
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,   // 1.25x input
    cacheWrite1h: 6.0,    // 2x input
    cacheRead: 0.3,       // 0.1x input
    longContextInput: 6.0,
    longContextOutput: 22.5,
  },
  "claude-haiku-4-5": {
    name: "Claude Haiku 4.5",
    provider: "claude",
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,   // 1.25x input
    cacheWrite1h: 2.0,    // 2x input
    cacheRead: 0.1,       // 0.1x input
  },

  // Previous generation models
  "claude-opus-4-5": {
    name: "Claude Opus 4.5",
    provider: "claude",
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },
  "claude-opus-4-1": {
    name: "Claude Opus 4.1",
    provider: "claude",
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  "claude-opus-4-0": {
    name: "Claude Opus 4",
    provider: "claude",
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  "claude-sonnet-4-5": {
    name: "Claude Sonnet 4.5",
    provider: "claude",
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
    longContextInput: 6.0,
    longContextOutput: 22.5,
  },
  "claude-sonnet-4-0": {
    name: "Claude Sonnet 4",
    provider: "claude",
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
    longContextInput: 6.0,
    longContextOutput: 22.5,
  },
  "claude-3-5-sonnet": {
    name: "Claude 3.5 Sonnet",
    provider: "claude",
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-3-5-haiku": {
    name: "Claude 3.5 Haiku",
    provider: "claude",
    input: 0.80,
    output: 4.0,
    cacheWrite5m: 1.0,
    cacheWrite1h: 1.6,
    cacheRead: 0.08,
  },
};

// ---------------------------------------------------------------------------
// OpenAI / Codex CLI Models
// ---------------------------------------------------------------------------

export const CODEX_PRICING: Record<string, ModelPricing> = {
  // O-series reasoning models
  "o3": {
    name: "o3",
    provider: "codex",
    input: 2.0,
    output: 8.0,
    cacheRead: 0.50,
  },
  "o3-pro": {
    name: "o3-pro",
    provider: "codex",
    input: 20.0,
    output: 80.0,
  },
  "o4-mini": {
    name: "o4-mini",
    provider: "codex",
    input: 1.10,
    output: 4.40,
    cacheRead: 0.275,
  },
  "o3-mini": {
    name: "o3-mini",
    provider: "codex",
    input: 1.10,
    output: 4.40,
    cacheRead: 0.55,
  },
  "o1": {
    name: "o1",
    provider: "codex",
    input: 15.0,
    output: 60.0,
    cacheRead: 7.50,
  },
  "o1-mini": {
    name: "o1-mini",
    provider: "codex",
    input: 1.10,
    output: 4.40,
    cacheRead: 0.55,
  },

  // GPT-4.1 series
  "gpt-4.1": {
    name: "GPT-4.1",
    provider: "codex",
    input: 2.0,
    output: 8.0,
    cacheRead: 0.50,
  },
  "gpt-4.1-mini": {
    name: "GPT-4.1 Mini",
    provider: "codex",
    input: 0.40,
    output: 1.60,
    cacheRead: 0.10,
  },
  "gpt-4.1-nano": {
    name: "GPT-4.1 Nano",
    provider: "codex",
    input: 0.10,
    output: 0.40,
    cacheRead: 0.025,
  },

  // GPT-4o series
  "gpt-4o": {
    name: "GPT-4o",
    provider: "codex",
    input: 2.50,
    output: 10.0,
    cacheRead: 1.25,
  },
  "gpt-4o-mini": {
    name: "GPT-4o Mini",
    provider: "codex",
    input: 0.15,
    output: 0.60,
    cacheRead: 0.075,
  },

  // GPT-5.4 series
  "gpt-5.4": {
    name: "GPT-5.4",
    provider: "codex",
    input: 2.50,
    output: 15.0,
    cacheRead: 0.25,
    longContextInput: 5.0,
    longContextOutput: 22.5,
  },
  "gpt-5.4-mini": {
    name: "GPT-5.4 Mini",
    provider: "codex",
    input: 0.75,
    output: 4.50,
    cacheRead: 0.075,
  },
  "gpt-5.4-nano": {
    name: "GPT-5.4 Nano",
    provider: "codex",
    input: 0.20,
    output: 1.25,
    cacheRead: 0.02,
  },
  "gpt-5.4-pro": {
    name: "GPT-5.4 Pro",
    provider: "codex",
    input: 30.0,
    output: 180.0,
    longContextInput: 60.0,
    longContextOutput: 270.0,
  },

  // GPT-5.x chat models
  "gpt-5.2": {
    name: "GPT-5.2",
    provider: "codex",
    input: 1.75,
    output: 14.0,
    cacheRead: 0.175,
  },
  "gpt-5.2-pro": {
    name: "GPT-5.2 Pro",
    provider: "codex",
    input: 21.0,
    output: 168.0,
  },
  "gpt-5.1": {
    name: "GPT-5.1",
    provider: "codex",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
  },
  "gpt-5": {
    name: "GPT-5",
    provider: "codex",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
  },
  "gpt-5-mini": {
    name: "GPT-5 Mini",
    provider: "codex",
    input: 0.25,
    output: 2.0,
    cacheRead: 0.025,
  },
  "gpt-5-nano": {
    name: "GPT-5 Nano",
    provider: "codex",
    input: 0.05,
    output: 0.40,
    cacheRead: 0.005,
  },
  "gpt-5-pro": {
    name: "GPT-5 Pro",
    provider: "codex",
    input: 15.0,
    output: 120.0,
  },

  // Codex-specific models
  "codex-mini": {
    name: "Codex Mini",
    provider: "codex",
    input: 1.50,
    output: 6.0,
    cacheRead: 0.375,
  },
  "gpt-5.3-codex": {
    name: "GPT-5.3 Codex",
    provider: "codex",
    input: 1.75,
    output: 14.0,
    cacheRead: 0.175,
  },
  "gpt-5.2-codex": {
    name: "GPT-5.2 Codex",
    provider: "codex",
    input: 1.75,
    output: 14.0,
    cacheRead: 0.175,
  },
  "gpt-5.1-codex-max": {
    name: "GPT-5.1 Codex Max",
    provider: "codex",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
  },
  "gpt-5.1-codex": {
    name: "GPT-5.1 Codex",
    provider: "codex",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
  },
  "gpt-5-codex": {
    name: "GPT-5 Codex",
    provider: "codex",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
  },
  "gpt-5.1-codex-mini": {
    name: "GPT-5.1 Codex Mini",
    provider: "codex",
    input: 0.25,
    output: 2.0,
    cacheRead: 0.025,
  },
  "gpt-5.3-codex-spark": {
    name: "GPT-5.3 Codex Spark",
    provider: "codex",
    input: 1.75,
    output: 14.0,
    cacheRead: 0.175,
  },
};

// ---------------------------------------------------------------------------
// Google Gemini CLI Models
// ---------------------------------------------------------------------------

export const GEMINI_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
    longContextInput: 2.50,
    longContextOutput: 15.0,
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    input: 0.30,
    output: 2.50,
    cacheRead: 0.03,
  },
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    input: 0.10,
    output: 0.40,
    cacheRead: 0.025,
  },
};

// ---------------------------------------------------------------------------
// Unified lookup
// ---------------------------------------------------------------------------

/** All model pricing in a single map, keyed by model ID */
export const ALL_PRICING: Record<string, ModelPricing> = {
  ...CLAUDE_PRICING,
  ...CODEX_PRICING,
  ...GEMINI_PRICING,
};

/**
 * Find pricing for a model ID. Supports fuzzy matching:
 * e.g. "claude-opus-4-6-20260301" will match "claude-opus-4-6"
 */
export function findPricing(modelId: string): ModelPricing | undefined {
  if (!modelId) return undefined;
  const normalized = modelId.toLowerCase();
  // Exact match first
  if (ALL_PRICING[normalized]) {
    return ALL_PRICING[normalized];
  }
  // Prefix match (model IDs often have date suffixes)
  const key = Object.keys(ALL_PRICING).find((k) => normalized.startsWith(k));
  if (key) return ALL_PRICING[key];
  // Reverse prefix match (e.g. "o3" matches "o3-something")
  const rkey = Object.keys(ALL_PRICING).find((k) => k.startsWith(normalized));
  return rkey ? ALL_PRICING[rkey] : undefined;
}
