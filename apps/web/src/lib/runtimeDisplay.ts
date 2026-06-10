import type { ChipColor } from "./status.ts";

const runtimeLabels: Record<string, string> = {
  "a2a": "A2A",
  "aion": "Aion",
  "claude-code": "Claude Code",
  "codex": "Codex",
  "custom": "自定义",
  "custom-acp": "自定义 ACP",
  "cursor": "Cursor",
  "goose": "Goose",
  "hermes": "Hermes",
  "kiro": "Kiro",
  "kimi": "Kimi",
  "langgraph": "LangGraph",
  "mock": "本地内置",
  "native": "AgentHub",
  "opencode": "OpenCode",
  "qwen": "Qwen"
};

const previewRuntimeKinds = new Set(["codex"]);

export function isInternalRuntimeKind(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "mock" || /^mock[-_\s]/u.test(normalized);
}

export function isInternalRuntimeRecord(record: {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly name?: unknown;
}): boolean {
  return isInternalRuntimeKind(record.kind) || isInternalRuntimeKind(record.id) || isInternalRuntimeKind(record.name);
}

export function isPreviewRuntimeKind(value: unknown): boolean {
  return typeof value === "string" && previewRuntimeKinds.has(value.trim().toLowerCase());
}

export function runtimeDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "运行时";
  const normalized = value.trim().toLowerCase();
  return runtimeLabels[normalized] ?? humanizeRuntimeIdentifier(value);
}

export function runtimeInstanceLabel(kind: unknown, name?: unknown): string {
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanKind = typeof kind === "string" ? kind.trim() : "";
  if (cleanName.length > 0 && !isInternalRuntimeKind(cleanName) && cleanName.toLowerCase() !== cleanKind.toLowerCase()) {
    return cleanName;
  }
  return runtimeDisplayName(kind);
}

export function runtimeChipColor(kind: unknown): ChipColor {
  if (kind === "native") return "success";
  if (kind === "claude-code") return "accent";
  if (kind === "opencode") return "warning";
  return "default";
}

function humanizeRuntimeIdentifier(value: string): string {
  return value
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
