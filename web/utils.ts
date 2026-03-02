export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

const SANITIZE_PATTERNS = [
  /<command-name>[^<]*<\/command-name>/g,
  /<command-message>[^<]*<\/command-message>/g,
  /<command-args>[^<]*<\/command-args>/g,
  /<local-command-stdout>[^<]*<\/local-command-stdout>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /^\s*Caveat:.*?unless the user explicitly asks you to\./s,
];

export interface ProviderInfo {
  label: string;
  color: string;
}

const PROVIDER_RULES: Array<{ test: (model: string) => boolean; info: ProviderInfo }> = [
  { test: (m) => m.startsWith("kimi"), info: { label: "Kimi", color: "text-purple-400 bg-purple-500/15 border-purple-500/25" } },
  { test: (m) => m.startsWith("glm"), info: { label: "GLM", color: "text-green-400 bg-green-500/15 border-green-500/25" } },
  { test: (m) => m.startsWith("claude"), info: { label: "Claude", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" } },
];

export function getProviderInfo(model?: string): ProviderInfo | null {
  if (!model || model === "<synthetic>") return null;
  for (const rule of PROVIDER_RULES) {
    if (rule.test(model)) return rule.info;
  }
  return { label: model, color: "text-zinc-400 bg-zinc-500/15 border-zinc-500/25" };
}

export function sanitizeText(text: string): string {
  let result = text;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}
